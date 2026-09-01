import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ApplyTestHooks } from "./types.js";
import { atomicReplaceFile } from "../path/fs.js";

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
    writeFileSync(tmp, content, { encoding: "utf-8" });
    atomicReplaceFile(tmp, absolutePath);
  } catch (err) {
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
}

export function restoreFile(absolutePath: string, original: string): void {
  writeFileSync(absolutePath, original, { encoding: "utf-8" });
}
