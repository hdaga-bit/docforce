import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import type {
  ComponentInfo,
  IntegrationInfo,
  Evidence,
  Provenance,
} from "../model/types.js";
import type { DocforceConfig } from "../config/types.js";
import { isExcluded } from "./exclusions.js";
import {
  discoverComponentRoots,
  resolveScanScope,
  walkSourceFiles,
  type ScanScope,
} from "./scanScope.js";

export interface SourceImportFindings {
  components: ComponentInfo[];
  integrations: IntegrationInfo[];
}

export interface ImportRecord {
  readonly sourceFile: string;
  readonly importedModule: string;
  readonly isExternal: boolean;
  readonly line: number;
  readonly kind: "static-import" | "dynamic-import" | "re-export";
}

function obs(sourceFile: string, detail: string): Provenance {
  const evidence: Evidence[] = [{ sourceFile, evidenceType: "source-analysis", detail }];
  return { kind: "observation", confidence: "high", evidence };
}

const INTEGRATION_IMPORTS: {
  module: RegExp;
  name: string;
  type: string;
  direction: "inbound" | "outbound" | "bidirectional";
  protocol?: string;
}[] = [
  { module: /^node:child_process$/, name: "Child Process Execution", type: "system", direction: "outbound", protocol: "spawn/exec" },
  { module: /^node:sqlite$/, name: "SQLite (native)", type: "database", direction: "bidirectional" },
  { module: /^@slack\/bolt$/, name: "Slack (Bolt SDK)", type: "external-api", direction: "bidirectional", protocol: "WebSocket" },
];

const IMPORT_PATTERNS: RegExp[] = [
  /^\s*import\s+(?:[\s\S]*?)\s+from\s+["']([^"']+)["']/,
  /^\s*import\s+["']([^"']+)["']/,
  /^\s*export\s+(?:[\s\S]*?)\s+from\s+["']([^"']+)["']/,
  /(?:^|[=(\s,;])(?:await\s+)?import\s*\(\s*["']([^"']+)["']\s*\)/,
];

export function scanSourceImports(
  repoRoot: string,
  analysisExclusions: readonly string[] = [],
  config?: DocforceConfig,
): SourceImportFindings {
  const result: SourceImportFindings = { components: [], integrations: [] };
  const scope = mergeScope(config, analysisExclusions);

  for (const root of discoverComponentRoots(repoRoot, scope)) {
    const indexFile = findIndexFile(join(repoRoot, root.path));
    const description = indexFile ? detectModulePurpose(join(repoRoot, root.path)) : undefined;
    result.components.push({
      id: root.id,
      name: root.id,
      path: root.path,
      description,
      type: "module",
      entryPoints: indexFile ? [`${root.path}/${indexFile}`] : undefined,
      provenance: obs(root.path, `Source directory: ${root.path}/`),
    });
  }

  const allImports = collectImportsScoped(repoRoot, scope);
  discoverIntegrationsFromImports(allImports, result);
  discoverIntegrationsFromContentScoped(repoRoot, scope, result);

  return result;
}

function mergeScope(config: DocforceConfig | undefined, analysisExclusions: readonly string[]): ScanScope {
  const base = resolveScanScope(config);
  return {
    include: base.include,
    sourceInclude: base.sourceInclude,
    exclude: [...base.exclude, ...analysisExclusions],
  };
}

function findIndexFile(dir: string): string | null {
  for (const name of ["index.ts", "index.js", "index.tsx", "index.jsx"]) {
    if (existsSync(join(dir, name))) return name;
  }
  return null;
}

function detectModulePurpose(dir: string): string | undefined {
  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((f) => (f.endsWith(".ts") || f.endsWith(".js") || f.endsWith(".tsx")) && !f.endsWith(".test.ts"))
      .sort();
  } catch {
    return undefined;
  }

  const exports: string[] = [];
  for (const file of files.slice(0, 5)) {
    try {
      const content = readFileSync(join(dir, file), "utf-8");
      const exportMatches = content.match(
        /export\s+(?:class|function|const|interface|type)\s+(\w+)/g,
      );
      if (exportMatches) {
        for (const m of exportMatches.slice(0, 3)) {
          const name = m.replace(/export\s+(?:class|function|const|interface|type)\s+/, "");
          exports.push(name);
        }
      }
    } catch {
      // skip
    }
  }

  if (exports.length === 0) return undefined;
  exports.sort();
  return `Exports: ${exports.slice(0, 5).join(", ")}`;
}

export function collectImports(
  srcDir: string,
  repoRoot: string,
  analysisExclusions: readonly string[],
): ImportRecord[] {
  const records: ImportRecord[] = [];
  walkSourceFilesForImports(srcDir, repoRoot, analysisExclusions, records, 0);
  return records;
}

export function collectImportsScoped(repoRoot: string, scope: ScanScope): ImportRecord[] {
  const records: ImportRecord[] = [];
  for (const file of walkSourceFiles(repoRoot, scope)) {
    if (file.relPath.endsWith(".py")) continue;
    const content = readFileSync(file.absPath, "utf-8");
    extractImportsFromSource(content, file.relPath, records);
  }
  return records;
}

function walkSourceFilesForImports(
  dir: string,
  repoRoot: string,
  analysisExclusions: readonly string[],
  records: ImportRecord[],
  depth: number,
): void {
  if (depth > 16) return;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
    const fullPath = join(dir, entry);

    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        const relDir = relative(repoRoot, fullPath);
        if (isExcluded(relDir, analysisExclusions)) continue;
        walkSourceFilesForImports(fullPath, repoRoot, analysisExclusions, records, depth + 1);
      } else if (
        (entry.endsWith(".ts") || entry.endsWith(".tsx") || entry.endsWith(".js") || entry.endsWith(".jsx") || entry.endsWith(".mts")) &&
        !entry.endsWith(".test.ts") &&
        !entry.endsWith(".d.ts")
      ) {
        const relPath = relative(repoRoot, fullPath).replace(/\\/g, "/");
        if (isExcluded(relPath, analysisExclusions)) continue;

        const content = readFileSync(fullPath, "utf-8");
        extractImportsFromSource(content, relPath, records);
      }
    } catch {
      // skip
    }
  }
}

function extractImportsFromSource(
  content: string,
  relPath: string,
  records: ImportRecord[],
): void {
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

    for (const pattern of IMPORT_PATTERNS) {
      const match = trimmed.match(pattern);
      if (match?.[1]) {
        const mod = match[1];
        const kind: ImportRecord["kind"] = pattern.source.includes("import\\s*\\(")
          ? "dynamic-import"
          : trimmed.startsWith("export")
            ? "re-export"
            : "static-import";

        records.push({
          sourceFile: relPath,
          importedModule: mod,
          isExternal: isExternalModule(mod),
          line: i + 1,
          kind,
        });
        break;
      }
    }
  }
}

function isExternalModule(mod: string): boolean {
  if (mod.startsWith(".") || mod.startsWith("/")) return false;
  if (mod.startsWith("@/")) return false;
  return true;
}

function discoverIntegrationsFromImports(
  allImports: ImportRecord[],
  result: SourceImportFindings,
): void {
  const seenIntegrations = new Set<string>();

  for (const record of allImports) {
    if (!record.isExternal) continue;

    for (const { module: modPattern, name, type, direction, protocol } of INTEGRATION_IMPORTS) {
      if (modPattern.test(record.importedModule) && !seenIntegrations.has(name)) {
        seenIntegrations.add(name);

        const evidence: Evidence[] = [{
          sourceFile: record.sourceFile,
          evidenceType: "module-import",
          line: record.line,
          detail: `import from "${record.importedModule}"`,
        }];

        result.integrations.push({
          name,
          type,
          direction,
          protocol,
          provenance: {
            kind: "observation",
            confidence: "high",
            evidence,
          },
        });
      }
    }
  }
}

function discoverIntegrationsFromContentScoped(
  repoRoot: string,
  scope: ScanScope,
  result: SourceImportFindings,
): void {
  const seenIntegrations = new Set<string>(result.integrations.map((i) => i.name));

  for (const file of walkSourceFiles(repoRoot, scope)) {
    if (file.relPath.endsWith(".py")) continue;
    const content = readFileSync(file.absPath, "utf-8");
    const github = /fetch\s*\(\s*['"`]https?:\/\/api\.github\.com/;
    if (github.test(content) && !seenIntegrations.has("GitHub API")) {
      seenIntegrations.add("GitHub API");
      const lines = content.split("\n");
      const lineIdx = lines.findIndex((l) => github.test(l));
      result.integrations.push({
        name: "GitHub API",
        type: "external-api",
        direction: "outbound",
        protocol: "REST",
        provenance: {
          kind: "observation",
          confidence: "high",
          evidence: [{
            sourceFile: file.relPath,
            evidenceType: "api-request",
            line: lineIdx >= 0 ? lineIdx + 1 : undefined,
            detail: "fetch() to api.github.com",
          }],
        },
      });
    }
  }
}

export { mergeScope };
