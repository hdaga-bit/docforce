import { readFileSync, existsSync } from "node:fs";
import { basename, extname } from "node:path";
import { tryGit } from "../runtime/exec.js";
import type { ChangeImpactReport } from "../impact/types.js";
import { classifyFile } from "../impact/fileClassifier.js";
import type { SystemModel } from "../model/types.js";
import type { AiReviewInput, FileContext, ContextLimits } from "./types.js";
import { DEFAULT_CONTEXT_LIMITS } from "./types.js";

const SECRET_PATTERNS = [
  /(?:api[_-]?key|apikey)\s*[:=]\s*["'][^"']{8,}/gi,
  /(?:access[_-]?token|bearer)\s*[:=]\s*["'][^"']{8,}/gi,
  /(?:secret|password|passwd|pwd)\s*[:=]\s*["'][^"']+["']/gi,
  /(?:private[_-]?key)\s*[:=]\s*["'][^"']+["']/gi,
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  /(?:sk-|pk-|ak-)[a-zA-Z0-9]{20,}/g,
];

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf",
  ".woff", ".woff2", ".ttf", ".eot", ".zip", ".gz", ".tgz",
  ".bin", ".exe", ".dll", ".so", ".dylib", ".wasm",
]);

export function redactSecrets(content: string): string {
  let result = content;
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, (match) => {
      const prefix = match.slice(0, Math.min(10, match.length));
      return `${prefix}[REDACTED]`;
    });
  }
  return result;
}

/**
 * Conservative gate for what may be sent to an AI provider.
 * Secret files, binaries, generated docs, DocForce internals, and
 * dependency trees are never collected.
 */
export function shouldCollectFile(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  const name = basename(normalized);

  if (normalized.includes("node_modules/")) return false;
  if (normalized.startsWith("docs/generated/") || normalized.startsWith(".docforce/")) return false;
  if (normalized.startsWith("src/docforce/")) return false;

  if (name === ".env" || name.startsWith(".env.")) return false;

  const ext = extname(name).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) return false;

  const cat = classifyFile(normalized);
  return cat === "source" || cat === "configuration" || cat === "infrastructure";
}

export function collectContext(
  repoRoot: string,
  impactReport: ChangeImpactReport,
  model: SystemModel,
  limits: ContextLimits = DEFAULT_CONTEXT_LIMITS,
): AiReviewInput {
  const relevantChanges = impactReport.fileChanges.filter((fc) => shouldCollectFile(fc.path));

  const sorted = [...relevantChanges].sort((a, b) => {
    const order: Record<string, number> = { modified: 0, added: 1, removed: 2, renamed: 3 };
    return (order[a.changeType] ?? 4) - (order[b.changeType] ?? 4);
  });

  const selectedFiles = sorted.slice(0, limits.maxFiles);
  let truncationApplied = sorted.length > limits.maxFiles;

  let totalChars = 0;
  const changedFiles: FileContext[] = [];

  for (const fc of selectedFiles) {
    if (totalChars >= limits.maxTotalChars) {
      truncationApplied = true;
      break;
    }

    const diff = getDiff(repoRoot, impactReport.baseRef, fc.path, impactReport.headRef);
    const diffRedacted = diff ? redactSecrets(truncate(diff, limits.maxCharsPerFile)) : undefined;
    const availableLineNumbers = diffRedacted
      ? parseDiffNewLineNumbers(diffRedacted)
      : [];

    let content: string | undefined;
    let truncated = false;
    const fullPath = `${repoRoot}/${fc.path}`;

    if (existsSync(fullPath) && fc.changeType !== "removed" && !isBinaryFile(fullPath)) {
      const nearby = extractNearbyContext(fullPath, availableLineNumbers, limits.maxContextLines);
      if (nearby) {
        if (nearby.length > limits.maxCharsPerFile) {
          content = redactSecrets(nearby.slice(0, limits.maxCharsPerFile));
          truncated = true;
        } else {
          content = redactSecrets(nearby);
        }
        for (const n of lineNumbersFromExcerpt(nearby)) {
          if (!availableLineNumbers.includes(n)) availableLineNumbers.push(n);
        }
      }
    }

    const fileChars = (diffRedacted?.length ?? 0) + (content?.length ?? 0);
    if (totalChars + fileChars > limits.maxTotalChars) {
      changedFiles.push({
        path: fc.path,
        diff: diffRedacted,
        content: undefined,
        truncated: true,
        availableLineNumbers: [...new Set(availableLineNumbers)].sort((a, b) => a - b),
      });
      totalChars += diffRedacted?.length ?? 0;
      continue;
    }

    changedFiles.push({
      path: fc.path,
      diff: diffRedacted,
      content,
      truncated,
      availableLineNumbers: [...new Set(availableLineNumbers)].sort((a, b) => a - b),
    });
    totalChars += fileChars;
  }

  const relevantModelFacts: string[] = [];
  for (const ds of model.datastores) {
    relevantModelFacts.push(`Datastore: ${ds.name} (${ds.type})`);
  }
  for (const integ of model.integrations) {
    relevantModelFacts.push(`Integration: ${integ.name} (${integ.type})`);
  }
  for (const tech of model.technologies) {
    relevantModelFacts.push(`Technology: ${tech.name}${tech.version ? ` ${tech.version}` : ""}`);
  }
  for (const comp of model.components) {
    relevantModelFacts.push(`Component: ${comp.id}`);
  }

  const affectedComponents = impactReport.fileChanges
    .map((fc) => {
      const match = fc.path.replace(/\\/g, "/").match(/^src\/([^/]+)/);
      return match?.[1] ?? null;
    })
    .filter((c): c is string => c !== null && c !== "docforce");

  return {
    changedFiles,
    impactReport: {
      overallImpactLevel: impactReport.overallImpactLevel,
      manualReviewRecommended: impactReport.manualReviewRecommended,
      manualReviewReason: impactReport.manualReviewReason,
      changedDomains: [...impactReport.modelDelta.changedDomains],
    },
    affectedComponents: [...new Set(affectedComponents)],
    relevantModelFacts,
    totalFilesAvailable: sorted.length,
    truncationApplied: truncationApplied || changedFiles.some((f) => f.truncated),
  };
}

export function parseDiffNewLineNumbers(diff: string): number[] {
  const lines: number[] = [];
  let newLine = 0;
  for (const raw of diff.split("\n")) {
    const hunk = raw.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (raw.startsWith("+++") || raw.startsWith("---") || raw.startsWith("diff ") || raw.startsWith("index ")) {
      continue;
    }
    if (raw.startsWith("+")) {
      lines.push(newLine);
      newLine += 1;
    } else if (raw.startsWith("-")) {
      // deleted line does not advance the new-file cursor
    } else {
      lines.push(newLine);
      newLine += 1;
    }
  }
  return lines;
}

function extractNearbyContext(
  fullPath: string,
  focusLines: readonly number[],
  maxContextLines: number,
): string | undefined {
  if (focusLines.length === 0 || maxContextLines <= 0) return undefined;
  let raw: string;
  try {
    raw = readFileSync(fullPath, "utf-8");
  } catch {
    return undefined;
  }
  if (raw.includes("\0")) return undefined;

  const fileLines = raw.split("\n");
  const min = Math.max(1, Math.min(...focusLines) - Math.floor(maxContextLines / 2));
  const max = Math.min(fileLines.length, Math.max(...focusLines) + Math.floor(maxContextLines / 2));
  const slice = fileLines.slice(min - 1, max);
  return slice.map((line, i) => `${min + i}|${line}`).join("\n");
}

function lineNumbersFromExcerpt(excerpt: string): number[] {
  const nums: number[] = [];
  for (const line of excerpt.split("\n")) {
    const m = line.match(/^(\d+)\|/);
    if (m) nums.push(Number(m[1]));
  }
  return nums;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

function isBinaryFile(fullPath: string): boolean {
  try {
    const buf = readFileSync(fullPath);
    const sample = buf.subarray(0, Math.min(buf.length, 8000));
    return sample.includes(0);
  } catch {
    return true;
  }
}

function getDiff(repoRoot: string, baseRef: string, path: string, headRef?: string): string | null {
  const cleanBase = baseRef.replace(/\s*\([^)]*\)$/, "");
  const cleanHead = headRef?.replace(/\s*\([^)]*\)$/, "");

  const args = cleanHead && cleanHead !== "WORKTREE"
    ? ["diff", `${cleanBase}...${cleanHead}`, "--", path]
    : ["diff", cleanBase, "--", path];
  return tryGit(args, { cwd: repoRoot, timeout: 10_000 });
}
