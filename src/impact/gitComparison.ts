import { execSync } from "node:child_process";
import type { FileChange, ChangeType } from "./types.js";

export function getChangedFiles(
  repoRoot: string,
  baseRef: string,
  headRef?: string,
): FileChange[] {
  const cmd = headRef
    ? `git diff --name-status ${baseRef}...${headRef}`
    : `git diff --name-status ${baseRef}`;

  let output: string;
  try {
    output = execSync(cmd, {
      cwd: repoRoot,
      encoding: "utf-8",
      timeout: 30_000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return [];
  }

  if (!output) return [];

  const changes: FileChange[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const status = parts[0]!.trim();
    const path = parts[1]?.trim() ?? "";

    if (status === "A") {
      changes.push({ path, changeType: "added" });
    } else if (status === "D") {
      changes.push({ path, changeType: "removed" });
    } else if (status === "M") {
      changes.push({ path, changeType: "modified" });
    } else if (status.startsWith("R")) {
      const oldPath = path;
      const newPath = parts[2]?.trim() ?? path;
      changes.push({ path: newPath, changeType: "renamed", oldPath });
    }
  }

  return changes;
}

export function resolveRef(repoRoot: string, ref: string): string | null {
  try {
    return execSync(`git rev-parse --short ${ref}`, {
      cwd: repoRoot,
      encoding: "utf-8",
      timeout: 5_000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}
