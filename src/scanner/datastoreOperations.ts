import { readFileSync } from "node:fs";
import type { ComponentInfo, DatastoreInfo, Evidence, Relationship } from "../model/types.js";
import type { DocforceConfig } from "../config/types.js";
import { resolveScanScope, walkSourceFiles, type ScanScope } from "./scanScope.js";
import { resolveComponentForFile, sanitizeId } from "./relationships.js";

const FIRESTORE_IMPORT = /from\s+["'](firebase(?:-admin)?\/firestore|firebase\/database|@google-cloud\/firestore)["']/;
const FIRESTORE_WRITE = /\b(setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction)\s*\(|\.(set|update|add|delete)\s*\(/;
const FIRESTORE_READ = /\b(getDoc|getDocs|onSnapshot)\s*\(|\.get\s*\(/;

const LOCAL_READ = /\blocalStorage\.getItem\s*\(/;
const LOCAL_WRITE = /\blocalStorage\.(setItem|removeItem)\s*\(/;

const IDB_WRITE = /\.put\s*\(|\.add\s*\(|\.delete\s*\(/;
const IDB_READ = /\.getAll\s*\(|\.get\s*\(/;
const IDB_PRESENT = /\bindexedDB\b/;

export function buildDatastoreOperationRelationships(
  repoRoot: string,
  components: readonly ComponentInfo[],
  datastores: readonly DatastoreInfo[],
  analysisExclusions: readonly string[],
  config?: DocforceConfig,
): Relationship[] {
  const base = resolveScanScope(config);
  const scope: ScanScope = { ...base, exclude: [...base.exclude, ...analysisExclusions] };
  const rels: Relationship[] = [];
  const seen = new Set<string>();

  const firebase = datastores.find((ds) => /firebase|firestore/i.test(`${ds.name} ${ds.engine ?? ""} ${ds.type}`));
  const localStore = datastores.find((ds) => ds.name === "localStorage");
  const idb = datastores.find((ds) => ds.name === "IndexedDB");

  for (const file of walkSourceFiles(repoRoot, scope)) {
    if (file.relPath.endsWith(".py")) continue;
    const content = readFileSync(file.absPath, "utf-8");
    const comp = resolveComponentForFile(file.relPath, components);
    if (!comp) continue;

    if (firebase && FIRESTORE_IMPORT.test(content)) {
      if (FIRESTORE_WRITE.test(content)) {
        pushRel(rels, seen, comp.id, firebase.name, "writes-to", {
          sourceFile: file.relPath,
          evidenceType: "firestore-operation",
          line: lineOf(content, FIRESTORE_WRITE),
          detail: "Firestore write operation",
        });
      }
      if (FIRESTORE_READ.test(content)) {
        pushRel(rels, seen, comp.id, firebase.name, "reads-from", {
          sourceFile: file.relPath,
          evidenceType: "firestore-operation",
          line: lineOf(content, FIRESTORE_READ),
          detail: "Firestore read operation",
        });
      }
    }

    if (localStore) {
      if (LOCAL_READ.test(content)) {
        pushRel(rels, seen, comp.id, localStore.name, "reads-from", {
          sourceFile: file.relPath,
          evidenceType: "browser-storage-operation",
          line: lineOf(content, LOCAL_READ),
          detail: "localStorage.getItem",
        });
      }
      if (LOCAL_WRITE.test(content)) {
        pushRel(rels, seen, comp.id, localStore.name, "writes-to", {
          sourceFile: file.relPath,
          evidenceType: "browser-storage-operation",
          line: lineOf(content, LOCAL_WRITE),
          detail: "localStorage write",
        });
      }
    }

    if (idb && IDB_PRESENT.test(content)) {
      if (IDB_WRITE.test(content)) {
        pushRel(rels, seen, comp.id, idb.name, "writes-to", {
          sourceFile: file.relPath,
          evidenceType: "indexeddb-operation",
          line: lineOf(content, IDB_WRITE),
          detail: "IndexedDB write operation",
        });
      }
      if (IDB_READ.test(content)) {
        pushRel(rels, seen, comp.id, idb.name, "reads-from", {
          sourceFile: file.relPath,
          evidenceType: "indexeddb-operation",
          line: lineOf(content, IDB_READ),
          detail: "IndexedDB read operation",
        });
      }
    }
  }

  return rels;
}

function pushRel(
  rels: Relationship[],
  seen: Set<string>,
  from: string,
  storeName: string,
  type: "reads-from" | "writes-to" | "persists-to",
  evidence: Evidence,
): void {
  const to = `store:${sanitizeId(storeName)}`;
  const id = `rel:${from}:${type}:${to}`;
  if (seen.has(id)) return;
  seen.add(id);
  rels.push({
    id,
    from,
    to,
    type,
    classification: "observation",
    confidence: "high",
    evidence: [evidence],
    description: `${from} ${type.replace("-", " ")} ${storeName}`,
  });
}

function lineOf(content: string, pattern: RegExp): number | undefined {
  const lines = content.split("\n");
  const idx = lines.findIndex((line) => pattern.test(line));
  return idx >= 0 ? idx + 1 : undefined;
}
