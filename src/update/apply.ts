import { writeFileSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import type { StagedArtifact } from "./staging.js";
import { writeGeneratedFile } from "../path/fs.js";

export interface ApplyResult {
  readonly applied: readonly string[];
  readonly created: readonly string[];
  readonly rolledBack: boolean;
  readonly error?: string;
}

/**
 * Apply staged artifacts to the working tree.
 * Creates backups first and rolls back on failure.
 */
export function applyArtifacts(
  staged: readonly StagedArtifact[],
  repoRoot: string,
): ApplyResult {
  const toWrite = staged.filter((s) => s.status === "would-update" || s.status === "would-create");
  if (toWrite.length === 0) {
    return { applied: [], created: [], rolledBack: false };
  }

  const backups = new Map<string, string>();
  const created: string[] = [];

  for (const s of toWrite) {
    const fullPath = resolve(repoRoot, s.path);
    if (existsSync(fullPath)) {
      backups.set(fullPath, readFileSync(fullPath, "utf-8"));
    }
  }

  const applied: string[] = [];
  try {
    for (const s of toWrite) {
      const fullPath = resolve(repoRoot, s.path);
      writeGeneratedFile(fullPath, s.content);
      if (s.status === "would-create") {
        created.push(s.path);
      }
      applied.push(s.path);
    }
    return { applied, created, rolledBack: false };
  } catch (err) {
    for (const [fullPath, content] of backups) {
      try { writeFileSync(fullPath, content, "utf-8"); } catch {}
    }
    for (const path of created) {
      const fullPath = resolve(repoRoot, path);
      try { if (existsSync(fullPath)) unlinkSync(fullPath); } catch {}
    }
    return {
      applied: [],
      created: [],
      rolledBack: true,
      error: (err instanceof Error) ? err.message : String(err),
    };
  }
}
