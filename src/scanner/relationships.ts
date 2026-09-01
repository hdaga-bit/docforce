import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative, dirname } from "node:path";
import type {
  Relationship,
  RelationshipType,
  Evidence,
  ComponentInfo,
  IntegrationInfo,
  DatastoreInfo,
} from "../model/types.js";
import type { DocforceConfig } from "../config/types.js";
import { isExcluded } from "./exclusions.js";
import { collectImports, collectImportsScoped } from "./sourceImports.js";
import { loadTsconfigPaths, resolveScanScope, walkSourceFiles, type ScanScope } from "./scanScope.js";

export interface RelationshipFindings {
  relationships: Relationship[];
}

export function buildInternalImportGraph(
  repoRoot: string,
  components: readonly ComponentInfo[],
  analysisExclusions: readonly string[],
  config?: DocforceConfig,
): Relationship[] {
  const base = resolveScanScope(config);
  const scope: ScanScope = {
    ...base,
    exclude: [...base.exclude, ...analysisExclusions],
  };

  const srcDir = resolve(repoRoot, "src");
  const allImports = config || !existsSync(srcDir)
    ? collectImportsScoped(repoRoot, scope)
    : collectImports(srcDir, repoRoot, analysisExclusions);

  const aliases = loadTsconfigPaths(repoRoot);
  const edgeMap = new Map<string, { evidence: Evidence[]; from: string; to: string }>();

  for (const imp of allImports) {
    if (imp.isExternal && !imp.importedModule.startsWith("@/")) continue;
    const fromComp = resolveComponentForFile(imp.sourceFile, components);
    if (!fromComp) continue;

    const resolvedTarget = resolveImportTarget(imp.sourceFile, imp.importedModule, aliases);
    if (!resolvedTarget) continue;

    if (isExcluded(resolvedTarget, analysisExclusions) ||
        isExcluded(resolvedTarget + ".ts", analysisExclusions)) continue;

    const toComp = resolveComponentForFile(resolvedTarget, components);
    if (!toComp || toComp.id === fromComp.id) continue;

    const key = `${fromComp.id}:${toComp.id}`;
    const existing = edgeMap.get(key);
    const ev: Evidence = {
      sourceFile: imp.sourceFile,
      evidenceType: "module-import",
      line: imp.line,
      detail: `imports ${imp.importedModule} → ${resolvedTarget}`,
    };

    if (existing) {
      existing.evidence.push(ev);
    } else {
      edgeMap.set(key, { from: fromComp.id, to: toComp.id, evidence: [ev] });
    }
  }

  const relationships: Relationship[] = [];
  for (const [_key, { from, to, evidence }] of [...edgeMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    relationships.push({
      id: `rel:${from}:imports:${to}`,
      from,
      to,
      type: "imports",
      classification: "observation",
      confidence: "high",
      evidence,
      description: `${from} imports ${to} (${evidence.length} file-level import${evidence.length > 1 ? "s" : ""})`,
    });
  }

  return relationships;
}

export function buildExternalIntegrationRelationships(
  components: readonly ComponentInfo[],
  integrations: readonly IntegrationInfo[],
): Relationship[] {
  const relationships: Relationship[] = [];

  for (const integ of integrations) {
    for (const ev of integ.provenance.evidence) {
      const comp = resolveComponentForFile(ev.sourceFile, components);
      if (!comp) continue;

      const relType = classifyExternalRelationshipType(ev.evidenceType, integ);
      const relId = `rel:${comp.id}:${relType}:ext:${sanitizeId(integ.name)}`;
      if (relationships.some((r) => r.id === relId)) continue;

      relationships.push({
        id: relId,
        from: comp.id,
        to: `ext:${sanitizeId(integ.name)}`,
        type: relType,
        classification: "observation",
        confidence: "high",
        evidence: [{
          sourceFile: ev.sourceFile,
          evidenceType: ev.evidenceType,
          line: ev.line,
          detail: ev.detail,
        }],
        description: `${comp.id} ${relType} ${integ.name}`,
      });
    }
  }

  return relationships;
}

function classifyExternalRelationshipType(
  evidenceType: string,
  integ: IntegrationInfo,
): RelationshipType {
  if (evidenceType === "api-request" || evidenceType === "local-constant-resolution") {
    return "calls-api";
  }
  if (evidenceType === "process-spawn") {
    return "spawns";
  }
  if (integ.type === "database") {
    return "persists-to";
  }
  if (evidenceType === "typescript-import" || evidenceType === "module-import" ||
      evidenceType === "package-dependency" || evidenceType === "database-import") {
    return "depends-on";
  }
  return "depends-on";
}

export function buildDatastoreRelationships(
  components: readonly ComponentInfo[],
  datastores: readonly DatastoreInfo[],
): Relationship[] {
  const relationships: Relationship[] = [];
  const seen = new Set<string>();

  for (const ds of datastores) {
    if (ds.type === "migration-directory" || ds.type === "schema-definition") continue;

    for (const ev of ds.provenance.evidence) {
      if (
        ev.evidenceType !== "source-import" &&
        ev.evidenceType !== "module-import" &&
        ev.evidenceType !== "database-import"
      ) continue;
      const comp = resolveComponentForFile(ev.sourceFile, components);
      if (!comp) continue;

      const relId = `rel:${comp.id}:persists-to:store:${sanitizeId(ds.name)}`;
      if (seen.has(relId)) continue;
      seen.add(relId);

      relationships.push({
        id: relId,
        from: comp.id,
        to: `store:${sanitizeId(ds.name)}`,
        type: "persists-to",
        classification: "observation",
        confidence: "high",
        evidence: [{
          sourceFile: ev.sourceFile,
          evidenceType: ev.evidenceType,
          line: ev.line,
          detail: ev.detail,
        }],
        description: `${comp.id} persists to ${ds.name}`,
      });
    }
  }

  return relationships;
}

export interface LocalConstantIntegration {
  name: string;
  type: string;
  direction: "inbound" | "outbound" | "bidirectional";
  protocol?: string;
  sourceFile: string;
  constantName: string;
  constantValue: string;
  usageLine: number;
}

const HOST_DISPLAY_NAMES: Record<string, string> = {
  "api.github.com": "GitHub API",
};

export function detectLocalConstantIntegrations(
  repoRoot: string,
  analysisExclusions: readonly string[],
  config?: DocforceConfig,
): LocalConstantIntegration[] {
  const results: LocalConstantIntegration[] = [];
  const base = resolveScanScope(config);
  const scope: ScanScope = { ...base, exclude: [...base.exclude, ...analysisExclusions] };
  const srcDir = resolve(repoRoot, "src");

  if (config || !existsSync(srcDir)) {
    for (const file of walkSourceFiles(repoRoot, scope)) {
      if (file.relPath.endsWith(".py")) continue;
      resolveLocalConstants(readFileSync(file.absPath, "utf-8"), file.relPath, results);
    }
    return results;
  }

  walkForConstantResolution(srcDir, repoRoot, analysisExclusions, results, 0);
  return results;
}

function walkForConstantResolution(
  dir: string,
  repoRoot: string,
  analysisExclusions: readonly string[],
  results: LocalConstantIntegration[],
  depth: number,
): void {
  if (depth > 16) return;
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }

  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
    const fullPath = join(dir, entry);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        const relDir = relative(repoRoot, fullPath);
        if (isExcluded(relDir, analysisExclusions)) continue;
        walkForConstantResolution(fullPath, repoRoot, analysisExclusions, results, depth + 1);
      } else if ((entry.endsWith(".ts") || entry.endsWith(".tsx") || entry.endsWith(".js")) && !entry.endsWith(".test.ts") && !entry.endsWith(".d.ts")) {
        const relPath = relative(repoRoot, fullPath).replace(/\\/g, "/");
        if (isExcluded(relPath, analysisExclusions)) continue;
        resolveLocalConstants(readFileSync(fullPath, "utf-8"), relPath, results);
      }
    } catch { /* skip */ }
  }
}

function resolveLocalConstants(
  content: string,
  relPath: string,
  results: LocalConstantIntegration[],
): void {
  const lines = content.split("\n");
  const constants = new Map<string, string>();
  const constPattern = /(?:const|let|var)\s+(\w+)\s*=\s*["'`]([^"'`]+)["'`]/;

  for (const line of lines) {
    const match = line.match(constPattern);
    if (match?.[1] && match[2]) constants.set(match[1], match[2]);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!/\bfetch\s*\(/.test(line)) continue;

    const templateRefs = line.match(/\$\{(\w+)\}/g) ?? [];
    for (const ref of templateRefs) {
      const varName = ref.slice(2, -1);
      const constValue = constants.get(varName);
      if (constValue) addHttpIntegration(results, relPath, varName, constValue, i + 1);
    }

    const ident = line.match(/fetch\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/);
    if (ident?.[1]) {
      const constValue = constants.get(ident[1]);
      if (constValue) addHttpIntegration(results, relPath, ident[1], constValue, i + 1);
    }
  }
}

function addHttpIntegration(
  results: LocalConstantIntegration[],
  relPath: string,
  constantName: string,
  constantValue: string,
  usageLine: number,
): void {
  const host = hostnameFromUrl(constantValue);
  if (!host) return;
  const name = HOST_DISPLAY_NAMES[host] ?? host;
  if (results.some((r) => r.name === name && r.sourceFile === relPath)) return;
  results.push({
    name,
    type: "external-api",
    direction: "outbound",
    protocol: "REST",
    sourceFile: relPath,
    constantName,
    constantValue: stripUrlSecrets(constantValue),
    usageLine,
  });
}

export function detectLiteralFetchIntegrations(
  repoRoot: string,
  analysisExclusions: readonly string[],
  config?: DocforceConfig,
): LocalConstantIntegration[] {
  const base = resolveScanScope(config);
  const scope: ScanScope = { ...base, exclude: [...base.exclude, ...analysisExclusions] };
  const results: LocalConstantIntegration[] = [];
  for (const file of walkSourceFiles(repoRoot, scope)) {
    if (file.relPath.endsWith(".py")) continue;
    const content = readFileSync(file.absPath, "utf-8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const match = line.match(/fetch\s*\(\s*[`'"](https?:\/\/[^`'"]+)[`'"]/);
      if (!match?.[1]) continue;
      const url = stripUrlSecrets(match[1]);
      const host = hostnameFromUrl(url);
      if (!host) continue;
      const name = HOST_DISPLAY_NAMES[host] ?? host;
      if (results.some((r) => r.name === name && r.sourceFile === file.relPath)) continue;
      results.push({
        name,
        type: "external-api",
        direction: "outbound",
        protocol: "REST",
        sourceFile: file.relPath,
        constantName: "(literal)",
        constantValue: url,
        usageLine: i + 1,
      });
    }
  }
  return results;
}

export function hostnameFromUrl(value: string): string | null {
  const match = value.match(/^https?:\/\/([^/?#:]+)(?::\d+)?/i);
  return match?.[1]?.toLowerCase() ?? null;
}

export function stripUrlSecrets(url: string): string {
  return url.replace(/\?.*$/, "").replace(/#.*$/, "");
}

export function resolveComponentForFile(
  filePath: string,
  components: readonly ComponentInfo[],
): ComponentInfo | undefined {
  const normalized = filePath.replace(/\\/g, "/");
  const matches = components.filter((c) => normalized === c.path || normalized.startsWith(c.path + "/"));
  matches.sort((a, b) => b.path.length - a.path.length);
  return matches[0];
}

function resolveImportTarget(
  sourceFile: string,
  importSpecifier: string,
  aliases: ReturnType<typeof loadTsconfigPaths>,
): string | null {
  if (importSpecifier.startsWith(".")) {
    const sourceDir = dirname(sourceFile);
    let resolved = join(sourceDir, importSpecifier).replace(/\\/g, "/");
    resolved = resolved.replace(/\.js$/, "").replace(/\.jsx$/, "").replace(/\.ts$/, "").replace(/\.tsx$/, "");
    return resolved.replace(/^\.\//, "");
  }

  for (const alias of aliases.prefixes) {
    if (importSpecifier === alias.prefix || importSpecifier.startsWith(alias.prefix)) {
      const rest = importSpecifier.slice(alias.prefix.length);
      return `${alias.target}${rest}`.replace(/\\/g, "/");
    }
  }
  return null;
}

export function sanitizeId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
