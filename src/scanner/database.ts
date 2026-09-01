import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import type { DocforceConfig } from "../config/types.js";
import type { DatastoreInfo, Evidence, Provenance } from "../model/types.js";
import { isExcluded } from "./exclusions.js";
import { resolveScanScope, walkSourceFiles } from "./scanScope.js";

export interface DatabaseFindings {
  datastores: DatastoreInfo[];
}

function obs(sourceFile: string, evidenceType: string, detail: string): Provenance {
  const evidence: Evidence[] = [{ sourceFile, evidenceType, detail }];
  return { kind: "observation", confidence: "high", evidence };
}

function inferred(evidence: Evidence[], reasoning: string): Provenance {
  return { kind: "inference", confidence: "medium", evidence, reasoning };
}

const DB_PACKAGE_MAP: Record<string, { engine: string; type: string }> = {
  "better-sqlite3": { engine: "SQLite", type: "embedded-database" },
  "sqlite3": { engine: "SQLite", type: "embedded-database" },
  "sql.js": { engine: "SQLite", type: "embedded-database" },
  "pg": { engine: "PostgreSQL", type: "relational-database" },
  "postgres": { engine: "PostgreSQL", type: "relational-database" },
  "@neondatabase/serverless": { engine: "PostgreSQL (Neon)", type: "relational-database" },
  "mysql2": { engine: "MySQL", type: "relational-database" },
  "mysql": { engine: "MySQL", type: "relational-database" },
  "mongodb": { engine: "MongoDB", type: "document-database" },
  "mongoose": { engine: "MongoDB", type: "document-database" },
  "redis": { engine: "Redis", type: "key-value-store" },
  "ioredis": { engine: "Redis", type: "key-value-store" },
  "@redis/client": { engine: "Redis", type: "key-value-store" },
  "prisma": { engine: "Prisma ORM", type: "orm" },
  "@prisma/client": { engine: "Prisma ORM", type: "orm" },
  "drizzle-orm": { engine: "Drizzle ORM", type: "orm" },
  "typeorm": { engine: "TypeORM", type: "orm" },
  "knex": { engine: "Knex.js", type: "query-builder" },
  "sequelize": { engine: "Sequelize", type: "orm" },
  "firebase": { engine: "Firebase", type: "cloud-database" },
  "firebase-admin": { engine: "Firebase", type: "cloud-database" },
  "@google-cloud/firestore": { engine: "Firestore", type: "cloud-database" },
};

export function scanDatabase(
  repoRoot: string,
  analysisExclusions: readonly string[] = [],
  config?: DocforceConfig,
): DatabaseFindings {
  const result: DatabaseFindings = { datastores: [] };

  scanPackageDeps(repoRoot, result);
  scanNodeSqliteImports(repoRoot, result, analysisExclusions);
  scanMigrationDirs(repoRoot, result);
  scanSchemaFiles(repoRoot, result);
  scanDatabasePathsInConfig(repoRoot, result);
  scanBrowserStorage(repoRoot, result, analysisExclusions, config);
  scanNamedFirebaseDatabase(repoRoot, result, analysisExclusions, config);

  return deduplicateDatastores(result);
}

function scanPackageDeps(repoRoot: string, result: DatabaseFindings): void {
  const pkgPath = resolve(repoRoot, "package.json");
  if (!existsSync(pkgPath)) return;

  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  } catch {
    return;
  }

  const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

  for (const [depName, version] of Object.entries(allDeps)) {
    const mapping = DB_PACKAGE_MAP[depName];
    if (mapping) {
      result.datastores.push({
        name: mapping.engine,
        type: mapping.type,
        engine: mapping.engine,
        provenance: obs("package.json", "dependency", `${depName}@${version}`),
      });
    }
  }
}

function scanNodeSqliteImports(
  repoRoot: string,
  result: DatabaseFindings,
  analysisExclusions: readonly string[],
): void {
  const srcDir = resolve(repoRoot, "src");
  if (!existsSync(srcDir)) return;

  const evidence: Evidence[] = [];
  scanDirForImport(srcDir, repoRoot, 'node:sqlite', evidence, 0, analysisExclusions);

  if (evidence.length > 0) {
    result.datastores.push({
      name: "SQLite (node:sqlite)",
      type: "embedded-database",
      engine: "SQLite",
      provenance: {
        kind: "observation",
        confidence: "high",
        evidence,
      },
    });
  }
}

function scanDirForImport(
  dir: string,
  repoRoot: string,
  importPattern: string,
  evidence: Evidence[],
  depth: number,
  analysisExclusions: readonly string[],
): void {
  if (depth > 5) return;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;

    try {
      if (!existsSync(fullPath)) continue;
      const stat = statSync(fullPath);
      const relPath = fullPath.slice(repoRoot.length + 1);

      if (stat.isDirectory()) {
        if (isExcluded(relPath, analysisExclusions)) continue;
        scanDirForImport(fullPath, repoRoot, importPattern, evidence, depth + 1, analysisExclusions);
      } else if (entry.endsWith(".ts") || entry.endsWith(".js")) {
        if (isExcluded(relPath, analysisExclusions)) continue;
        const content = readFileSync(fullPath, "utf-8");
        if (content.includes(`"${importPattern}"`) || content.includes(`'${importPattern}'`)) {
          const lineNum = content.split("\n").findIndex((l) => l.includes(importPattern));
          evidence.push({
            sourceFile: relPath,
            evidenceType: "database-import",
            line: lineNum >= 0 ? lineNum + 1 : undefined,
            detail: `import from "${importPattern}"`,
          });
        }
      }
    } catch {
      // skip inaccessible
    }
  }
}

function scanMigrationDirs(repoRoot: string, result: DatabaseFindings): void {
  const migrationDirs = ["migrations", "db/migrations", "prisma/migrations", "drizzle"];

  for (const dir of migrationDirs) {
    const fullPath = resolve(repoRoot, dir);
    if (!existsSync(fullPath)) continue;

    let files: string[];
    try {
      files = readdirSync(fullPath);
    } catch {
      continue;
    }

    if (files.length > 0) {
      result.datastores.push({
        name: `Database Migrations (${dir})`,
        type: "migration-directory",
        provenance: obs(dir, "directory-exists", `${files.length} migration file(s)`),
      });
    }
  }
}

function scanSchemaFiles(repoRoot: string, result: DatabaseFindings): void {
  const schemaFiles = [
    { path: "prisma/schema.prisma", engine: "Prisma Schema" },
    { path: "drizzle.config.ts", engine: "Drizzle Config" },
    { path: "drizzle.config.js", engine: "Drizzle Config" },
    { path: "knexfile.js", engine: "Knex Config" },
    { path: "knexfile.ts", engine: "Knex Config" },
  ];

  for (const { path: schemaPath, engine } of schemaFiles) {
    const fullPath = resolve(repoRoot, schemaPath);
    if (existsSync(fullPath)) {
      result.datastores.push({
        name: engine,
        type: "schema-definition",
        engine,
        provenance: obs(schemaPath, "file-exists", `${schemaPath} present`),
      });
    }
  }
}

function scanDatabasePathsInConfig(repoRoot: string, result: DatabaseFindings): void {
  const envFiles = [".env.example", ".env.sample"];

  for (const envFile of envFiles) {
    const filePath = resolve(repoRoot, envFile);
    if (!existsSync(filePath)) continue;

    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    for (const line of lines) {
      const trimmed = line.trim().replace(/^#\s*/, "");

      if (/DB_PATH|DATABASE_URL|DATABASE_FILE|SQLITE/i.test(trimmed)) {
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const varName = trimmed.slice(0, eqIdx).trim();
        const varValue = trimmed.slice(eqIdx + 1).trim();

        const evidence: Evidence[] = [{
          sourceFile: envFile,
          evidenceType: "env-variable",
          detail: `${varName}=${varValue}`,
        }];

        if (varValue.endsWith(".db") || varValue.includes("sqlite")) {
          result.datastores.push({
            name: "SQLite",
            type: "embedded-database",
            engine: "SQLite",
            location: varValue,
            provenance: inferred(evidence, `Database path ${varName} points to SQLite file`),
          });
        } else if (varValue.startsWith("postgres://") || varValue.startsWith("postgresql://")) {
          result.datastores.push({
            name: "PostgreSQL",
            type: "relational-database",
            engine: "PostgreSQL",
            provenance: inferred(evidence, `${varName} uses PostgreSQL connection string`),
          });
        } else if (varValue.startsWith("mysql://")) {
          result.datastores.push({
            name: "MySQL",
            type: "relational-database",
            engine: "MySQL",
            provenance: inferred(evidence, `${varName} uses MySQL connection string`),
          });
        } else if (varValue.startsWith("redis://")) {
          result.datastores.push({
            name: "Redis",
            type: "key-value-store",
            engine: "Redis",
            provenance: inferred(evidence, `${varName} uses Redis connection string`),
          });
        }
      }
    }
  }
}

function scanBrowserStorage(
  repoRoot: string,
  result: DatabaseFindings,
  analysisExclusions: readonly string[],
  config?: DocforceConfig,
): void {
  const base = resolveScanScope(config);
  const scope = { ...base, exclude: [...base.exclude, ...analysisExclusions] };
  let sawLocal = false;
  let sawIdb = false;
  for (const file of walkSourceFiles(repoRoot, scope)) {
    if (file.relPath.endsWith(".py")) continue;
    const content = readFileSync(file.absPath, "utf-8");
    if (!sawLocal && /\blocalStorage\./.test(content)) {
      sawLocal = true;
      result.datastores.push({
        name: "localStorage",
        type: "browser-storage",
        engine: "localStorage",
        provenance: obs(file.relPath, "browser-storage-operation", "localStorage usage"),
      });
    }
    if (!sawIdb && /\bindexedDB\b/.test(content)) {
      sawIdb = true;
      result.datastores.push({
        name: "IndexedDB",
        type: "browser-storage",
        engine: "IndexedDB",
        provenance: obs(file.relPath, "indexeddb-operation", "indexedDB usage"),
      });
    }
  }
}

function scanNamedFirebaseDatabase(
  repoRoot: string,
  result: DatabaseFindings,
  analysisExclusions: readonly string[],
  config?: DocforceConfig,
): void {
  const firebaseJson = resolve(repoRoot, "firebase.json");
  if (existsSync(firebaseJson)) {
    try {
      const parsed = JSON.parse(readFileSync(firebaseJson, "utf-8")) as { database?: string };
      if (typeof parsed.database === "string" && parsed.database) {
        result.datastores.push({
          name: "Firebase",
          type: "cloud-database",
          engine: "Firebase",
          location: parsed.database,
          provenance: obs("firebase.json", "file-exists", `database: ${parsed.database}`),
        });
      }
    } catch { /* ignore */ }
  }

  const base = resolveScanScope(config);
  const scope = { ...base, exclude: [...base.exclude, ...analysisExclusions] };
  for (const file of walkSourceFiles(repoRoot, scope)) {
    if (file.relPath.endsWith(".py")) continue;
    const content = readFileSync(file.absPath, "utf-8");
    const constants = sameFileStringConstants(content);
    const named = content.match(/initializeFirestore\s*\([^;]*?,\s*["']([^"']+)["']\s*\)/);
    const named3 = content.match(/initializeFirestore\s*\((?:[^,]*,){2}\s*["']([^"']+)["']/);
    const getFsLiteral = content.match(/getFirestore\s*\(\s*[^,]+,\s*["']([^"']+)["']/);
    const getFsIdent = content.match(/getFirestore\s*\(\s*[^,]+,\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/);
    const id = named?.[1]
      ?? named3?.[1]
      ?? getFsLiteral?.[1]
      ?? (getFsIdent?.[1] ? constants.get(getFsIdent[1]) : undefined);
    if (id) {
      result.datastores.push({
        name: "Firebase",
        type: "cloud-database",
        engine: "Firebase",
        location: id,
        provenance: obs(file.relPath, "source-analysis", `Firestore named database id ${id}`),
      });
    }
  }
}

function sameFileStringConstants(content: string): Map<string, string> {
  const constants = new Map<string, string>();
  const pattern = /(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content))) {
    constants.set(match[1]!, match[2]!);
  }
  return constants;
}

function deduplicateDatastores(findings: DatabaseFindings): DatabaseFindings {
  const seen = new Map<string, DatastoreInfo>();

  for (const ds of findings.datastores) {
    const key = `${ds.engine ?? ds.name}:${ds.type}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, ds);
    } else {
      seen.set(key, {
        ...existing,
        location: existing.location ?? ds.location,
        provenance: {
          ...existing.provenance,
          evidence: [...existing.provenance.evidence, ...ds.provenance.evidence],
        },
      });
    }
  }

  return { datastores: Array.from(seen.values()) };
}
