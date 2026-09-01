import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type {
  RuntimeInfo,
  LanguageInfo,
  TechnologyInfo,
  Evidence,
  Provenance,
} from "../model/types.js";

export interface PackageJsonFindings {
  runtime: RuntimeInfo[];
  languages: LanguageInfo[];
  technologies: TechnologyInfo[];
}

interface PackageJson {
  name?: string;
  version?: string;
  type?: string;
  engines?: Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const CATEGORY_MAP: Record<string, { category: string; purpose: string }> = {
  "@slack/bolt": { category: "messaging", purpose: "Slack bot framework (Socket Mode)" },
  "dotenv": { category: "configuration", purpose: "Environment variable loading" },
  "zod": { category: "validation", purpose: "Schema validation" },
  "tsx": { category: "tooling", purpose: "TypeScript execution" },
  "typescript": { category: "language", purpose: "TypeScript compiler" },
  "react": { category: "frontend", purpose: "UI library" },
  "react-dom": { category: "frontend", purpose: "React DOM rendering" },
  "next": { category: "framework", purpose: "React server framework" },
  "vite": { category: "tooling", purpose: "Build tool and dev server" },
  "vitest": { category: "testing", purpose: "Test runner" },
  "eslint": { category: "tooling", purpose: "Linter" },
  "express": { category: "framework", purpose: "HTTP server framework" },
  "fastify": { category: "framework", purpose: "HTTP server framework" },
  "prisma": { category: "database", purpose: "ORM / database toolkit" },
  "@prisma/client": { category: "database", purpose: "Prisma client" },
  "better-sqlite3": { category: "database", purpose: "SQLite driver" },
  "pg": { category: "database", purpose: "PostgreSQL driver" },
  "mysql2": { category: "database", purpose: "MySQL driver" },
  "redis": { category: "database", purpose: "Redis client" },
  "ioredis": { category: "database", purpose: "Redis client" },
  "firebase": { category: "cloud", purpose: "Firebase SDK" },
  "firebase-admin": { category: "cloud", purpose: "Firebase Admin SDK" },
};

function obs(sourceFile: string, evidenceType: string, detail?: string): Provenance {
  const evidence: Evidence[] = [{ sourceFile, evidenceType, detail }];
  return { kind: "observation", confidence: "high", evidence };
}

export function scanPackageJson(repoRoot: string): PackageJsonFindings {
  const filePath = resolve(repoRoot, "package.json");
  const result: PackageJsonFindings = { runtime: [], languages: [], technologies: [] };

  if (!existsSync(filePath)) return result;

  let pkg: PackageJson;
  try {
    pkg = JSON.parse(readFileSync(filePath, "utf-8")) as PackageJson;
  } catch {
    return result;
  }

  const relPath = "package.json";

  result.runtime.push({
    name: "Node.js",
    version: pkg.engines?.["node"],
    provenance: obs(relPath, "package-manifest", "Identified from package.json existence"),
  });

  if (pkg.type === "module") {
    result.languages.push({
      name: "TypeScript (ESM)",
      provenance: obs(relPath, "package-field", `"type": "module"`),
    });
  }

  const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

  if (allDeps["typescript"]) {
    result.languages.push({
      name: "TypeScript",
      version: allDeps["typescript"]?.replace(/[\^~]/, ""),
      provenance: obs(relPath, "dependency", `typescript@${allDeps["typescript"]}`),
    });
  }

  for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
    if (name === "@mary/docforce") continue;
    const mapping = CATEGORY_MAP[name];
    if (mapping && name !== "typescript") {
      result.technologies.push({
        name,
        version: version?.replace(/[\^~]/, ""),
        category: mapping.category,
        purpose: mapping.purpose,
        provenance: obs(relPath, "dependency", `${name}@${version}`),
      });
    } else if (!mapping) {
      result.technologies.push({
        name,
        version: version?.replace(/[\^~]/, ""),
        category: "dependency",
        purpose: "Declared runtime dependency",
        provenance: obs(relPath, "dependency", `${name}@${version}`),
      });
    }
  }

  for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) {
    if (name === "@mary/docforce" || name === "typescript") continue;
    const mapping = CATEGORY_MAP[name];
    if (mapping) {
      result.technologies.push({
        name,
        version: version?.replace(/[\^~]/, ""),
        category: mapping.category,
        purpose: mapping.purpose,
        provenance: obs(relPath, "devDependency", `${name}@${version}`),
      });
    }
  }

  if (pkg.scripts) {
    for (const [scriptName, scriptCmd] of Object.entries(pkg.scripts)) {
      if (scriptCmd?.includes("tsx --test") || scriptCmd?.includes("vitest")) {
        result.technologies.push({
          name: scriptCmd.includes("vitest") ? "vitest" : "node:test",
          category: "testing",
          purpose: `Test runner (via npm run ${scriptName})`,
          provenance: obs(relPath, "script", `scripts.${scriptName}: "${scriptCmd}"`),
        });
        break;
      }
    }
  }

  return result;
}
