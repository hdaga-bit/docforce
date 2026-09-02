import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { DEFAULT_DOCS_OUTPUT, type DocforceConfig } from "../config/types.js";
import { DEFAULT_PR_CONFIG } from "../config/index.js";
import {
  DEFAULT_PUBLICATION_CONFIG,
  mergePublicationTheme,
  type DocforcePublicationConfig,
} from "../publication/config.js";
import { toModelPath } from "../path/canonical.js";

export const SAFE_EXCLUDES = [
  "node_modules/**",
  ".git/**",
  ".docforce/**",
  "docs/generated/**",
  "docs/published/**",
  "dist/**",
  "build/**",
  "out/**",
] as const;

const SOURCE_DIRS = ["src", "app", "lib", "components", "services", "packages"] as const;
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".docforce", "dist", "build", "out", "docs", "vendor",
  "coverage", ".next", ".turbo", ".cache",
]);

export const TRIAL_DIR = ".docforce/trial";

export interface InferOptions {
  readonly repoRoot: string;
  readonly name?: string;
  readonly type?: string;
  readonly organization?: string;
  readonly description?: string;
}

export interface InferredRepository {
  readonly config: DocforceConfig;
  readonly include: readonly string[];
  readonly productName: string;
  readonly productType: string;
  readonly description: string;
  readonly detected: readonly string[];
}

export function inferRepository(options: InferOptions): InferredRepository {
  const repoRoot = options.repoRoot;
  const pkg = readPackageJson(repoRoot);
  const productName = suggestProductName(options.name, pkg?.name, basename(repoRoot));
  const productType = options.type?.trim() || inferProductType(pkg);
  const description = options.description?.trim()
    || pkg?.description
    || readmeTitle(repoRoot)
    || "";

  const include = discoverIncludes(repoRoot);
  const exclude: string[] = [...SAFE_EXCLUDES];
  if (existsSync(join(repoRoot, "vendor"))) exclude.push("vendor/**");

  const organization = options.organization?.trim() ?? "";
  const publication: DocforcePublicationConfig = {
    ...DEFAULT_PUBLICATION_CONFIG,
    organization: { name: organization },
    footer: { text: organization },
    theme: mergePublicationTheme({ footerText: organization }),
  };

  const detected = detectStackHints(repoRoot, pkg);

  const config: DocforceConfig = {
    schemaVersion: "1.0.0",
    product: {
      name: productName,
      type: productType,
      description,
    },
    scanning: {
      rootDir: ".",
      include,
      exclude,
    },
    analysis: { exclude: [] },
    architecture: { components: {} },
    output: {
      systemModel: ".docforce/system-model.json",
      docs: { ...DEFAULT_DOCS_OUTPUT },
    },
    documentation: { allowedRoots: ["docs/"], aiAssisted: [] },
    ai: {},
    pr: DEFAULT_PR_CONFIG,
    publication,
  };

  return { config, include, productName, productType, description, detected };
}

export function trialConfig(inferred: InferredRepository): DocforceConfig {
  const docs: Record<string, string> = {};
  for (const [key, path] of Object.entries(DEFAULT_DOCS_OUTPUT)) {
    docs[key] = path.replace(/^docs\/generated\//, `${TRIAL_DIR}/generated/`);
  }
  return {
    ...inferred.config,
    output: {
      systemModel: `${TRIAL_DIR}/system-model.json`,
      docs: docs as unknown as DocforceConfig["output"]["docs"],
    },
    publication: {
      ...DEFAULT_PUBLICATION_CONFIG,
      ...inferred.config.publication,
      outputDir: TRIAL_DIR,
    },
  };
}

export function suggestProductName(
  cliName: string | undefined,
  packageName: string | undefined,
  directoryName: string,
): string {
  const fromCli = cliName?.trim();
  if (fromCli) return fromCli;
  const fromPkg = unscopedPackageName(packageName);
  if (fromPkg) return fromPkg;
  const fromDir = directoryName.replace(/[^\w.-]+/g, "").replace(/^-+|-+$/g, "");
  return fromDir || "Application";
}

export function unscopedPackageName(name: string | undefined): string | undefined {
  if (!name?.trim()) return undefined;
  const trimmed = name.trim();
  const slash = trimmed.lastIndexOf("/");
  return (slash >= 0 ? trimmed.slice(slash + 1) : trimmed) || undefined;
}

function inferProductType(pkg: PackageHint | undefined): string {
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  if (deps["next"]) return "web-application";
  return "application";
}

function discoverIncludes(repoRoot: string): string[] {
  const include: string[] = [];
  for (const dir of SOURCE_DIRS) {
    if (isDirectory(join(repoRoot, dir))) include.push(`${dir}/**`);
  }
  for (const root of discoverPythonServiceRoots(repoRoot)) {
    const pattern = `${root}/**`;
    if (!include.includes(pattern)) include.push(pattern);
  }
  for (const file of [
    "package.json",
    "docker-compose.yml",
    "docker-compose.yaml",
    "balena.yml",
    "requirements.txt",
    "pyproject.toml",
  ]) {
    if (existsSync(join(repoRoot, file))) include.push(file);
  }
  for (const name of safeRootEntries(repoRoot)) {
    if (/^Dockerfile(\.|$)/i.test(name) && isFile(join(repoRoot, name))) {
      include.push(name);
    }
  }
  if (include.length === 0) {
    include.push("package.json");
  }
  return include;
}

function discoverPythonServiceRoots(repoRoot: string): string[] {
  const roots: string[] = [];
  for (const name of safeRootEntries(repoRoot)) {
    if (SKIP_DIRS.has(name)) continue;
    if ((SOURCE_DIRS as readonly string[]).includes(name)) continue;
    const abs = join(repoRoot, name);
    if (!isDirectory(abs)) continue;
    if (
      existsSync(join(abs, "requirements.txt"))
      || existsSync(join(abs, "pyproject.toml"))
      || directoryHasPythonFile(abs)
    ) {
      roots.push(toModelPath(name));
    }
  }
  return roots;
}

function directoryHasPythonFile(dir: string): boolean {
  try {
    return readdirSync(dir).some((name) => name.endsWith(".py") && isFile(join(dir, name)));
  } catch {
    return false;
  }
}

function detectStackHints(repoRoot: string, pkg: PackageHint | undefined): string[] {
  const hints: string[] = [];
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  if (existsSync(join(repoRoot, "tsconfig.json")) || deps["typescript"]) hints.push("TypeScript");
  else if (pkg) hints.push("JavaScript");
  if (deps["next"]) hints.push("Next.js");
  if (deps["react"]) hints.push("React");
  if (pkg?.engines?.node || deps["next"] || pkg) hints.push("Node.js");
  if (existsSync(join(repoRoot, "requirements.txt")) || existsSync(join(repoRoot, "pyproject.toml"))) {
    hints.push("Python");
  }
  if (existsSync(join(repoRoot, "docker-compose.yml")) || existsSync(join(repoRoot, "docker-compose.yaml"))) {
    hints.push("Docker Compose");
  }
  return unique(hints);
}

function readmeTitle(repoRoot: string): string | undefined {
  for (const name of ["README.md", "Readme.md", "readme.md"]) {
    const path = join(repoRoot, name);
    if (!existsSync(path)) continue;
    try {
      const text = readFileSync(path, "utf-8");
      const match = text.match(/^#\s+(.+)$/m);
      const title = match?.[1]?.trim();
      if (title && title.length > 0 && title.length <= 80 && !/^https?:/i.test(title)) {
        return title;
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}

interface PackageHint {
  readonly name?: string;
  readonly description?: string;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly engines?: { readonly node?: string };
}

function readPackageJson(repoRoot: string): PackageHint | undefined {
  const path = join(repoRoot, "package.json");
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as PackageHint;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function safeRootEntries(repoRoot: string): string[] {
  try {
    return readdirSync(repoRoot);
  } catch {
    return [];
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
