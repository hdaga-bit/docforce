import { mkdirSync, renameSync, rmSync, unlinkSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { toGeneratedText } from "./lineEnding.js";

const RM_RETRIES = 10;
const RM_RETRY_DELAY_MS = 50;

export function writeGeneratedFile(absolutePath: string, content: string): void {
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, toGeneratedText(content), { encoding: "utf-8" });
}

/**
 * Replace `dest` with `fromTmp`. POSIX rename overwrites; Windows cannot
 * rename onto an existing file, so the destination is moved aside first
 * and restored if the final rename fails.
 */
export function atomicReplaceFile(fromTmp: string, dest: string): void {
  try {
    renameSync(fromTmp, dest);
    return;
  } catch (err) {
    if (!existsSync(dest)) throw err;
    const bak = `${dest}.docforce-replace-${process.pid}-${Date.now()}.bak`;
    renameSync(dest, bak);
    try {
      renameSync(fromTmp, dest);
    } catch (inner) {
      try { renameSync(bak, dest); } catch { /* restore original dest */ }
      throw inner;
    }
    try { unlinkSync(bak); } catch { /* leftover backup is non-fatal */ }
  }
}

export function removeTree(path: string): void {
  rmSync(path, {
    recursive: true,
    force: true,
    maxRetries: RM_RETRIES,
    retryDelay: RM_RETRY_DELAY_MS,
  });
}
