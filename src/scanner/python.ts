import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DocforceConfig } from "../config/types.js";
import type { LanguageInfo, Provenance, Relationship, TechnologyInfo } from "../model/types.js";
import {
  discoverComponentRoots,
  resolveScanScope,
  walkSourceFiles,
} from "./scanScope.js";
import { resolveComponentForFile } from "./relationships.js";

export interface PythonFindings {
  languages: LanguageInfo[];
  technologies: TechnologyInfo[];
  pythonRoots: string[];
  relationships: Relationship[];
}

function obs(sourceFile: string, evidenceType: string, detail: string): Provenance {
  return {
    kind: "observation",
    confidence: "high",
    evidence: [{ sourceFile, evidenceType, detail }],
  };
}

export function scanPython(repoRoot: string, config?: DocforceConfig): PythonFindings {
  const result: PythonFindings = {
    languages: [],
    technologies: [],
    pythonRoots: [],
    relationships: [],
  };
  const scope = resolveScanScope(config);
  const pyFiles = walkSourceFiles(repoRoot, scope).filter((f) => f.relPath.endsWith(".py"));

  if (pyFiles.length > 0) {
    result.languages.push({
      name: "Python",
      provenance: obs(pyFiles[0]!.relPath, "file-exists", `${pyFiles.length} Python source file(s)`),
    });
  }

  const componentRoots = discoverComponentRoots(repoRoot, scope);
  result.pythonRoots = componentRoots
    .filter((root) => pyFiles.some((f) => f.relPath === root.path || f.relPath.startsWith(`${root.path}/`)))
    .map((root) => root.path);

  const manifests = new Set<string>();
  if (existsSync(join(repoRoot, "requirements.txt"))) manifests.add("requirements.txt");
  if (existsSync(join(repoRoot, "pyproject.toml"))) manifests.add("pyproject.toml");
  for (const file of pyFiles) {
    const dir = dirname(file.relPath);
    const req = dir === "." ? "requirements.txt" : `${dir}/requirements.txt`;
    if (existsSync(join(repoRoot, req))) manifests.add(req);
    const pyproject = dir === "." ? "pyproject.toml" : `${dir}/pyproject.toml`;
    if (existsSync(join(repoRoot, pyproject))) manifests.add(pyproject);
  }

  for (const rel of [...manifests].sort()) {
    const content = readFileSync(join(repoRoot, rel), "utf-8");
    if (rel.endsWith("requirements.txt")) parseRequirements(content, rel, result);
    else parsePyproject(content, rel, result);
  }

  const components = componentRoots.map((root) => ({
    id: root.id,
    name: root.id,
    path: root.path,
    type: "module",
    provenance: obs(root.path, "source-analysis", `Source directory: ${root.path}/`),
  }));
  result.relationships = collectPythonImportRelationships(pyFiles, components);

  return result;
}

function collectPythonImportRelationships(
  pyFiles: readonly { relPath: string; absPath: string }[],
  components: readonly { id: string; path: string; name: string; type: string; provenance: Provenance }[],
): Relationship[] {
  const edgeMap = new Map<string, Relationship>();

  for (const file of pyFiles) {
    const fromComp = resolveComponentForFile(file.relPath, components);
    if (!fromComp) continue;
    let content: string;
    try {
      content = readFileSync(file.absPath, "utf-8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i]!.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const imported = parsePythonImport(trimmed);
      if (!imported) continue;
      if (imported.kind === "external") continue;

      const toComp = imported.kind === "relative"
        ? fromComp
        : components.find((c) => c.id === imported.root || imported.module.startsWith(`${c.path.replace(/\//g, ".")}.`) || imported.module === c.path.replace(/\//g, "."));
      if (!toComp || toComp.id === fromComp.id) continue;

      const id = `rel:${fromComp.id}:imports:${toComp.id}`;
      const existing = edgeMap.get(id);
      const evidence = {
        sourceFile: file.relPath,
        evidenceType: "python-import" as const,
        line: i + 1,
        detail: trimmed,
      };
      if (existing) {
        edgeMap.set(id, { ...existing, evidence: [...existing.evidence, evidence] });
      } else {
        edgeMap.set(id, {
          id,
          from: fromComp.id,
          to: toComp.id,
          type: "imports",
          classification: "observation",
          confidence: "high",
          evidence: [evidence],
          description: `${fromComp.id} imports ${toComp.id}`,
        });
      }
    }
  }

  return [...edgeMap.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function parsePythonImport(line: string): { kind: "relative" | "internal" | "external"; module: string; root: string } | null {
  const fromMatch = line.match(/^from\s+(\S+)\s+import\s+/);
  const importMatch = line.match(/^import\s+([A-Za-z0-9_.]+)/);
  const module = fromMatch?.[1] ?? importMatch?.[1];
  if (!module) return null;
  if (module.startsWith(".")) return { kind: "relative", module, root: "" };
  const root = module.split(".")[0]!;
  if (PYTHON_STDLIB.has(root) || root === "__future__") return { kind: "external", module, root };
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(root)) {
    return { kind: "internal", module, root };
  }
  return { kind: "external", module, root };
}

const PYTHON_STDLIB = new Set([
  "os", "sys", "json", "re", "typing", "pathlib", "collections", "subprocess",
  "asyncio", "logging", "datetime", "time", "math", "http", "urllib", "io",
  "abc", "enum", "dataclasses", "functools", "itertools", "tempfile", "shutil",
  "argparse", "unittest", "hashlib", "base64", "copy", "struct", "socket",
  "ssl", "email", "html", "xml", "csv", "configparser", "threading", "queue",
  "multiprocessing", "concurrent", "contextlib", "warnings", "traceback",
  "inspect", "importlib", "pkgutil", "glob", "fnmatch", "stat", "signal",
]);

function parseRequirements(content: string, relPath: string, result: PythonFindings): void {
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("-")) continue;
    const match = line.match(/^([A-Za-z0-9_.-]+)\s*(==|>=|<=|~=|!=|>|<)?\s*([^#\s]+)?/);
    if (!match?.[1]) continue;
    const name = match[1];
    if (result.technologies.some((t) => t.name === name)) continue;
    result.technologies.push({
      name,
      version: match[2] === "==" ? match[3] : undefined,
      category: "dependency",
      purpose: `Python dependency declared in ${relPath}`,
      provenance: obs(relPath, "python-dependency", line.split("#")[0]!.trim()),
    });
  }
}

function parsePyproject(content: string, relPath: string, result: PythonFindings): void {
  const depBlock = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
  if (!depBlock?.[1]) return;
  for (const raw of depBlock[1].split("\n")) {
    const match = raw.match(/["']([A-Za-z0-9_.-]+)(==|>=)?([^"']*)["']/);
    if (!match?.[1]) continue;
    if (result.technologies.some((t) => t.name === match[1])) continue;
    result.technologies.push({
      name: match[1],
      version: match[2] === "==" ? match[3] : undefined,
      category: "dependency",
      purpose: `Python dependency declared in ${relPath}`,
      provenance: obs(relPath, "python-dependency", match[0]),
    });
  }
}
