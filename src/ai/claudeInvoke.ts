import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { ProviderUnavailableError } from "../review/provider.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_CHARS = 200_000;

export function resolveClaudeExecutable(configuredCommand?: string): string | undefined {
  const fromEnv = process.env.DOCFORCE_CLAUDE_PATH?.trim();
  const candidate = fromEnv || configuredCommand?.trim() || "claude";

  if (isAbsolute(candidate) || candidate.startsWith(".") || candidate.includes("/")) {
    return existsSync(candidate) ? candidate : undefined;
  }

  const probe = process.platform === "win32" ? "where.exe" : "which";
  try {
    execFileSync(probe, [candidate], { stdio: "pipe" });
    return candidate;
  } catch {
    return undefined;
  }
}

export function isClaudeCliAvailable(command?: string): boolean {
  return resolveClaudeExecutable(command) !== undefined;
}

export async function invokeClaudePrint(
  prompt: string,
  options: { command?: string; timeoutMs?: number } = {},
): Promise<{ stdout: string; latencyMs: number; command: string }> {
  const command = resolveClaudeExecutable(options.command);
  if (!command) {
    throw new ProviderUnavailableError("claude-cli", "executable not found (set DOCFORCE_CLAUDE_PATH or ai.claude.command)");
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const scratch = mkdtempSync(join(tmpdir(), "docforce-ai-"));
  const startedAt = Date.now();

  try {
    const stdout = await runClaudePrint(command, prompt, scratch, timeoutMs);
    return { stdout, latencyMs: Date.now() - startedAt, command };
  } finally {
    try { rmSync(scratch, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function runClaudePrint(
  command: string,
  prompt: string,
  cwd: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ["--print", "--output-format", "json", prompt], {
      cwd,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new ProviderUnavailableError("claude-cli", `timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_CHARS) {
        stdout += chunk.toString("utf-8");
        if (stdout.length > MAX_OUTPUT_CHARS) stdout = stdout.slice(0, MAX_OUTPUT_CHARS);
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new ProviderUnavailableError("claude-cli", err.message));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new ProviderUnavailableError(
          "claude-cli",
          `exit ${code}${stderr.trim() ? `: ${stderr.trim().slice(0, 400)}` : ""}`,
        ));
        return;
      }
      resolve(stdout);
    });
  });
}

export interface ParsedClaudePrint {
  resultText: string;
  sessionId?: string;
  modelId?: string;
  inputTokens?: number;
  outputTokens?: number;
  isError: boolean;
}

export function parseClaudePrintJson(stdout: string): ParsedClaudePrint {
  const trimmed = stdout.trim();
  const obj = tryParseObject(trimmed) ?? findLastJsonObject(trimmed);
  if (!obj) {
    return { resultText: trimmed, isError: false };
  }

  const resultText =
    (typeof obj.result === "string" && obj.result) ||
    (typeof obj.summary === "string" && obj.summary) ||
    trimmed;

  const usage = (obj.usage && typeof obj.usage === "object")
    ? obj.usage as Record<string, unknown>
    : undefined;

  return {
    resultText,
    sessionId: stringField(obj.session_id) ?? stringField(obj.sessionId),
    modelId: stringField(obj.model),
    inputTokens: numberField(usage?.input_tokens) ?? numberField(obj.input_tokens),
    outputTokens: numberField(usage?.output_tokens) ?? numberField(obj.output_tokens),
    isError: obj.is_error === true || obj.isError === true,
  };
}

export function extractJsonCandidate(resultText: string): unknown {
  const candidates = [
    resultText.trim(),
    extractJsonFence(resultText),
    extractFirstJsonObject(resultText),
  ].filter((s): s is string => Boolean(s));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }
  return undefined;
}

function extractJsonFence(text: string): string | undefined {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return m?.[1]?.trim();
}

function extractFirstJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  return text.slice(start, end + 1);
}

function tryParseObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function findLastJsonObject(text: string): Record<string, unknown> | undefined {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const parsed = tryParseObject(lines[i] ?? "");
    if (parsed && (parsed.type === "result" || parsed.result || parsed.session_id)) {
      return parsed;
    }
  }
  return undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
