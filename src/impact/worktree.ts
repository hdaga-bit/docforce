import { execSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, resolveConfigPath } from "../config/index.js";
import { runAllScanners } from "../scanner/index.js";
import { buildSystemModel } from "../model/builder.js";
import type { SystemModel } from "../model/types.js";

export interface WorktreeResult {
  readonly model: SystemModel;
  readonly cleanup: () => void;
}

/**
 * Create a temporary worktree for a given Git ref, run the DocForce scanner,
 * and return the resulting SystemModel.
 */
export function scanAtRef(
  repoRoot: string,
  ref: string,
): SystemModel {
  try {
    execSync(`git rev-parse --verify ${ref}`, {
      cwd: repoRoot,
      encoding: "utf-8",
      timeout: 5_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    throw new Error(`Invalid Git ref: "${ref}". Cannot resolve to a commit.`);
  }

  const worktreeDir = join(tmpdir(), `docforce-worktree-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  let cleanupError: Error | null = null;

  try {
    execSync(`git worktree add --detach "${worktreeDir}" ${ref}`, {
      cwd: repoRoot,
      encoding: "utf-8",
      timeout: 30_000,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const configPath = resolveConfigPath(worktreeDir);
    let config;
    try {
      config = loadConfig(configPath);
    } catch {
      config = loadConfig(resolveConfigPath(repoRoot));
    }

    const scanResults = runAllScanners(worktreeDir, config);
    const model = buildSystemModel(worktreeDir, configPath, config, scanResults);
    return model;
  } finally {
    try {
      if (existsSync(worktreeDir)) {
        rmSync(worktreeDir, { recursive: true, force: true });
      }
      execSync(`git worktree prune`, {
        cwd: repoRoot,
        timeout: 10_000,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      cleanupError = err instanceof Error ? err : new Error(String(err));
      console.error(`Warning: worktree cleanup failed: ${cleanupError.message}`);
    }
  }
}

/**
 * Scan the current working tree (as-is, no worktree needed).
 */
export function scanWorkingTree(repoRoot: string): SystemModel {
  const configPath = resolveConfigPath(repoRoot);
  const config = loadConfig(configPath);
  const scanResults = runAllScanners(repoRoot, config);
  return buildSystemModel(repoRoot, configPath, config, scanResults);
}
