import { AiChangeAssessmentSchema } from "./types.js";
import type { AiReviewInput, AiChangeAssessment, AiProviderMetadata } from "./types.js";
import type { ReasoningProvider, ReasoningProviderResult } from "./provider.js";
import { ProviderUnavailableError } from "./provider.js";
import { buildUserPrompt } from "./prompt.js";
import {
  invokeClaudePrint,
  isClaudeCliAvailable,
  parseClaudePrintJson,
  extractJsonCandidate,
  resolveClaudeExecutable,
} from "../ai/claudeInvoke.js";

/**
 * Isolated Claude Code CLI adapter for AI change review.
 * Does NOT import MaryForce Claude application classes.
 */
export class ClaudeCliProvider implements ReasoningProvider {
  readonly name = "claude-cli";
  private readonly command?: string;
  private readonly timeoutMs?: number;

  constructor(options: { command?: string; timeoutMs?: number } = {}) {
    this.command = options.command;
    this.timeoutMs = options.timeoutMs;
  }

  async analyzeChange(input: AiReviewInput, systemPrompt: string): Promise<ReasoningProviderResult> {
    const executable = resolveClaudeExecutable(this.command);
    if (!executable) {
      throw new ProviderUnavailableError(this.name, `${this.command ?? "claude"} is not available`);
    }

    const userPrompt = buildUserPrompt(input);
    const combined = `${systemPrompt}\n\n${userPrompt}`;
    const { stdout, latencyMs } = await invokeClaudePrint(combined, {
      command: executable,
      timeoutMs: this.timeoutMs,
    });
    const parsed = parseClaudePrintJson(stdout);
    if (parsed.isError) {
      throw new ProviderUnavailableError(this.name, "Claude reported an error");
    }
    const assessment = extractAssessment(parsed.resultText);
    const metadata: AiProviderMetadata = {
      providerName: this.name,
      modelId: parsed.modelId,
      requestId: parsed.sessionId,
      latencyMs,
      inputTokens: parsed.inputTokens,
      outputTokens: parsed.outputTokens,
    };
    return { assessment, metadata };
  }
}

export { isClaudeCliAvailable, resolveClaudeExecutable };

export function extractAssessment(resultText: string): AiChangeAssessment {
  const parsed = extractJsonCandidate(resultText);
  const result = AiChangeAssessmentSchema.safeParse(parsed);
  if (result.success) return result.data;
  throw new ProviderUnavailableError(
    "claude-cli",
    "malformed or schema-invalid JSON assessment in Claude response",
  );
}

export { parseClaudePrintJson };
