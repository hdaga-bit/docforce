import type { FileChange } from "./types.js";
import { tryGit } from "../runtime/exec.js";
import { toModelPath } from "../path/canonical.js";

export function getChangedFiles(
  repoRoot: string,
  baseRef: string,
  headRef?: string,
): FileChange[] {
  const args = headRef
    ? ["diff", "--name-status", `${baseRef}...${headRef}`]
    : ["diff", "--name-status", baseRef];

  const output = tryGit(args, { cwd: repoRoot, timeout: 30_000 });
  if (!output) return [];

  const changes: FileChange[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const status = parts[0]!.trim();
    const path = toModelPath(parts[1]?.trim() ?? "");

    if (status === "A") {
      changes.push({ path, changeType: "added" });
    } else if (status === "D") {
      changes.push({ path, changeType: "removed" });
    } else if (status === "M") {
      changes.push({ path, changeType: "modified" });
    } else if (status.startsWith("R")) {
      const oldPath = path;
      const newPath = toModelPath(parts[2]?.trim() ?? path);
      changes.push({ path: newPath, changeType: "renamed", oldPath });
    }
  }

  return changes;
}

export function resolveRef(repoRoot: string, ref: string): string | null {
  return tryGit(["rev-parse", "--short", ref], { cwd: repoRoot, timeout: 5_000 });
}
