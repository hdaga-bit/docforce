import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { DocforceConfig, DocforceScanningConfig } from "../config/types.js";
import { isExcluded, matchesGlob } from "./exclusions.js";

export const ALWAYS_EXCLUDED = [
  "node_modules/**",
  "**/node_modules/**",
  "vendor/**",
  ".git/**",
  ".docforce/**",
  "dist/**",
  ".next/**",
  "docs/generated/**",
  "**/__pycache__/**",
] as const;

export const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs", ".py"] as const;

const DEFAULT_SOURCE_INCLUDE = ["src/**"];
const MAX_WALK_DEPTH = 16;

export interface ScanScope {
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  readonly sourceInclude: readonly string[];
}

export function resolveScanScope(config?: DocforceConfig): ScanScope {
  const scanning: DocforceScanningConfig | undefined = config?.scanning;
  const include = scanning?.include ?? [];
  const exclude = [
    ...ALWAYS_EXCLUDED,
    ...(scanning?.exclude ?? []),
    ...(config?.analysis.exclude ?? []),
  ];
  const sourceInclude = include.length > 0 ? include : DEFAULT_SOURCE_INCLUDE;
  return { include, exclude, sourceInclude };
}

export function isAlwaysExcludedPath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/");
  if (normalized.split("/").includes("node_modules")) return true;
  if (normalized.split("/").includes("vendor")) return true;
  if (normalized.split("/").includes(".git")) return true;
  return isExcluded(normalized, ALWAYS_EXCLUDED);
}

export function isInInclude(relPath: string, include: readonly string[]): boolean {
  const normalized = relPath.replace(/\\/g, "/");
  if (include.length === 0) return true;
  return include.some((pattern) => {
    if (matchesGlob(normalized, pattern)) return true;
    // Directory prefixes: "app/**" should consider files under app/
    if (pattern.endsWith("/**")) {
      const prefix = pattern.slice(0, -3);
      if (normalized === prefix || normalized.startsWith(`${prefix}/`)) return true;
    }
    return false;
  });
}

export function isScannedPath(relPath: string, scope: ScanScope, kind: "source" | "manifest"): boolean {
  const normalized = relPath.replace(/\\/g, "/");
  if (isAlwaysExcludedPath(normalized)) return false;
  if (isExcluded(normalized, scope.exclude)) return false;
  const patterns = kind === "source" ? scope.sourceInclude : (scope.include.length > 0 ? scope.include : ["**"]);
  return isInInclude(normalized, patterns);
}

export function isSourceFileName(name: string): boolean {
  if (name.endsWith(".d.ts")) return false;
  if (name.endsWith(".test.ts") || name.endsWith(".test.tsx") || name.endsWith(".spec.ts") || name.endsWith(".spec.tsx")) {
    return false;
  }
  return SOURCE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export interface WalkedFile {
  readonly relPath: string;
  readonly absPath: string;
}

export function walkScopedFiles(
  repoRoot: string,
  scope: ScanScope,
  kind: "source" | "manifest",
  predicate: (relPath: string, name: string) => boolean,
): WalkedFile[] {
  const out: WalkedFile[] = [];
  const seen = new Set<string>();
  walkDir(repoRoot, repoRoot, scope, kind, predicate, out, seen, 0);
  out.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return out;
}

function walkDir(
  dir: string,
  repoRoot: string,
  scope: ScanScope,
  kind: "source" | "manifest",
  predicate: (relPath: string, name: string) => boolean,
  out: WalkedFile[],
  seen: Set<string>,
  depth: number,
): void {
  if (depth > MAX_WALK_DEPTH) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  entries.sort();
  for (const name of entries) {
    if (name === "node_modules" || name === ".git" || name === "vendor" || name === ".docforce" || name === ".next") {
      continue;
    }
    const absPath = join(dir, name);
    let relPath = relative(repoRoot, absPath).replace(/\\/g, "/");
    if (relPath.startsWith("./")) relPath = relPath.slice(2);
    if (isAlwaysExcludedPath(relPath) || isExcluded(relPath, scope.exclude)) continue;
    try {
      const st = statSync(absPath);
      if (st.isDirectory()) {
        walkDir(absPath, repoRoot, scope, kind, predicate, out, seen, depth + 1);
      } else if (predicate(relPath, name) && isScannedPath(relPath, scope, kind)) {
        if (!seen.has(relPath)) {
          seen.add(relPath);
          out.push({ relPath, absPath });
        }
      }
    } catch {
      // skip
    }
  }
}

export function walkSourceFiles(repoRoot: string, scope: ScanScope): WalkedFile[] {
  return walkScopedFiles(repoRoot, scope, "source", (relPath, name) => isSourceFileName(name) && isScannedPath(relPath, scope, "source"));
}

export function directoryHasSource(repoRoot: string, relDir: string, scope: ScanScope): boolean {
  const abs = join(repoRoot, relDir);
  if (!existsSync(abs)) return false;
  const files = walkSourceFiles(repoRoot, {
    include: scope.include,
    exclude: scope.exclude,
    sourceInclude: [`${relDir}/**`, relDir],
  });
  return files.length > 0;
}

/**
 * Component boundary rule (v1.0):
 *
 * A software component is a first-level scanned source root, not every nested folder.
 *
 * 1. Each include pattern that names a directory (e.g. `app/**`, `lib/**`) is a
 *    candidate component root if the directory exists and contains source files.
 * 2. If the directory basename is `src`, expand one level to immediate child
 *    directories (the historical Node/TS package layout used by MaryForce).
 * 3. Nested directories under a component root are not additional components.
 * 4. Manifest files (package.json, compose, Dockerfiles) are not components.
 * 5. node_modules / vendor / .docforce never become components.
 */
export function discoverComponentRoots(repoRoot: string, scope: ScanScope): { id: string; path: string }[] {
  const prefixes = new Set<string>();
  for (const pattern of scope.sourceInclude) {
    const prefix = directoryPrefix(pattern);
    if (!prefix || prefix.includes(".")) continue;
    prefixes.add(prefix);
  }

  const roots: { id: string; path: string }[] = [];
  const seenIds = new Set<string>();

  for (const prefix of [...prefixes].sort()) {
    const abs = join(repoRoot, prefix);
    if (!existsSync(abs)) continue;
    try {
      if (!statSync(abs).isDirectory()) continue;
    } catch {
      continue;
    }
    if (isAlwaysExcludedPath(prefix) || isExcluded(prefix, scope.exclude)) continue;

    const base = prefix.split("/").pop()!;
    if (base === "src") {
      let children: string[];
      try {
        children = readdirSync(abs).sort();
      } catch {
        continue;
      }
      for (const child of children) {
        const childRel = `${prefix}/${child}`;
        const childAbs = join(repoRoot, childRel);
        try {
          if (!statSync(childAbs).isDirectory()) continue;
        } catch {
          continue;
        }
        if (isAlwaysExcludedPath(childRel) || isExcluded(childRel, scope.exclude) || isExcluded(`${childRel}/**`, scope.exclude)) {
          continue;
        }
        if (!directoryHasSource(repoRoot, childRel, scope)) continue;
        const id = uniqueId(child, childRel, seenIds);
        roots.push({ id, path: childRel });
      }
    } else {
      if (!directoryHasSource(repoRoot, prefix, scope)) continue;
      const id = uniqueId(base, prefix, seenIds);
      roots.push({ id, path: prefix });
    }
  }

  roots.sort((a, b) => a.path.localeCompare(b.path));
  return roots;
}

function uniqueId(candidate: string, path: string, seen: Set<string>): string {
  let id = candidate;
  if (seen.has(id)) {
    id = path.replace(/\\/g, "/").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  }
  seen.add(id);
  return id;
}

function directoryPrefix(pattern: string): string | null {
  const normalized = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized.includes("*") || normalized.includes("?")) {
    const cut = normalized.replace(/\/\*\*$/, "").replace(/\/\*$/, "");
    if (cut.includes("*") || cut.includes("?")) return null;
    return cut || null;
  }
  // Exact file — not a component root
  if (/\.[a-zA-Z0-9]+$/.test(normalized)) return null;
  return normalized;
}

export interface TsconfigPaths {
  readonly prefixes: { readonly prefix: string; readonly target: string }[];
}

export function loadTsconfigPaths(repoRoot: string): TsconfigPaths {
  const prefixes: { prefix: string; target: string }[] = [];
  const filePath = join(repoRoot, "tsconfig.json");
  if (!existsSync(filePath)) return { prefixes };
  try {
    const raw = readFileSync(filePath, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const parsed = JSON.parse(raw) as { compilerOptions?: { paths?: Record<string, string[]> } };
    const paths = parsed.compilerOptions?.paths ?? {};
    for (const [from, targets] of Object.entries(paths)) {
      const target = targets[0];
      if (!target) continue;
      const prefix = from.endsWith("*") ? from.slice(0, -1) : from;
      const dest = target.endsWith("*") ? target.slice(0, -1) : target;
      prefixes.push({ prefix, target: dest.replace(/^\.\//, "") });
    }
  } catch {
    return { prefixes };
  }
  return { prefixes };
}

export function readFileIfPresent(absPath: string): string | null {
  try {
    return readFileSync(absPath, "utf-8");
  } catch {
    return null;
  }
}
