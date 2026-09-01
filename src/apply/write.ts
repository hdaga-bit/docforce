import { writeFileSync, renameSync, unlinkSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import type { ApplyTestHooks } from "./types.js";

export function atomicWriteFile(
  absolutePath: string,
  content: string,
  hooks?: ApplyTestHooks,
): void {
  if (hooks?.forceWriteError) {
    throw new Error("Forced write failure (test)");
  }
  mkdirSync(dirname(absolutePath), { recursive: true });
  const tmp = join(dirname(absolutePath), `.docforce-apply-${process.pid}-${Date.now()}.tmp`);
  try {
    writeFileSync(tmp, content, "utf-8");
    renameSync(tmp, absolutePath);
  } catch (err) {
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
}

export function restoreFile(absolutePath: string, original: string): void {
  writeFileSync(absolutePath, original, "utf-8");
}
