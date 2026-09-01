import type { ReasoningProvider, ReasoningProviderResult } from "./provider.js";
import { ProviderUnavailableError } from "./provider.js";
import type { AiReviewInput, AiChangeAssessment } from "./types.js";

function allDiffs(input: AiReviewInput): string {
  return input.changedFiles
    .map((f) => `${f.diff ?? ""} ${f.content ?? ""}`)
    .join("\n")
    .toLowerCase();
}

function firstChangedPath(input: AiReviewInput): string {
  return input.changedFiles[0]?.path ?? "unknown";
}

/** Cite only paths/line ranges that were actually supplied to the provider. */
export function citeSuppliedEvidence(
  files: readonly { path: string; availableLineNumbers?: readonly number[] }[],
): { path: string; startLine?: number; endLine?: number }[] {
  const f = files[0];
  if (!f?.path) return [];
  const lines = f.availableLineNumbers ?? [];
  if (lines.length === 0) {
    return [{ path: f.path }];
  }
  return [{ path: f.path, startLine: lines[0], endLine: lines[lines.length - 1] }];
}

export class FakeProvider implements ReasoningProvider {
  readonly name = "fake";

  async analyzeChange(input: AiReviewInput, _systemPrompt: string): Promise<ReasoningProviderResult> {
    const text = allDiffs(input);
    const path = firstChangedPath(input);
    const evidence = citeSuppliedEvidence(input.changedFiles);

    let assessment: AiChangeAssessment;

    if (/role\s*===?\s*["']admin["']|permission|authorize|isadmin/i.test(text)) {
      assessment = {
        behavioralChangeDetected: true,
        summary: "Authorization logic changed — admin role check modified",
        concerns: ["security", "authorization"],
        confidence: "high",
        documentationRecommendations: [
          {
            area: "security",
            impact: "high",
            reason: "Authorization rules modified — security documentation must reflect new access controls",
            evidence,
          },
        ],
        evidence,
        uncertainties: [],
        requiresHumanConfirmation: true,
      };
    } else if (/retr(y|ies)|attempt|backoff|max.?retries/i.test(text)) {
      assessment = {
        behavioralChangeDetected: true,
        summary: "Retry behavior changed — may affect reliability characteristics",
        concerns: ["reliability"],
        confidence: "medium",
        documentationRecommendations: [
          {
            area: "reliability",
            impact: "medium",
            reason: "Retry configuration changed — reliability documentation should be updated",
            evidence,
          },
        ],
        evidence,
        uncertainties: ["Exact failure scenarios affected are unclear from diff alone"],
        requiresHumanConfirmation: false,
      };
    } else if (/catch\s*\([^)]*\)\s*\{\s*\}|catch\s*\{|ignore.*error|swallow/i.test(text)) {
      assessment = {
        behavioralChangeDetected: true,
        summary: "Error handling changed — errors may be silently swallowed",
        concerns: ["error-handling", "reliability"],
        confidence: "high",
        documentationRecommendations: [
          {
            area: "reliability",
            impact: "medium",
            reason: "Silent error swallowing detected — reliability documentation should note error handling gaps",
            evidence,
          },
        ],
        evidence,
        uncertainties: [],
        requiresHumanConfirmation: true,
      };
    } else if (/response.*field|rename.*field|field.*rename|apiresponse|responseBody/i.test(text)) {
      assessment = {
        behavioralChangeDetected: true,
        summary: "API response contract changed — field renamed",
        concerns: ["api-contract"],
        confidence: "high",
        documentationRecommendations: [
          {
            area: "api-contract",
            impact: "high",
            reason: "API response field renamed — contract documentation must be updated",
            evidence,
          },
        ],
        evidence,
        uncertainties: [],
        requiresHumanConfirmation: false,
      };
    } else if (/console\.log|logger\.info|log\.debug/i.test(text) && !/role|retry|catch|response.*field/i.test(text)) {
      assessment = {
        behavioralChangeDetected: false,
        summary: "Logging changes only — no behavioral impact detected",
        concerns: ["observability"],
        confidence: "high",
        documentationRecommendations: [
          {
            area: "operations",
            impact: "low",
            reason: "Logging added or modified — minimal documentation impact",
            evidence: [{ path }],
          },
        ],
        evidence: [{ path }],
        uncertainties: [],
        requiresHumanConfirmation: false,
      };
    } else if (/rename.*local|const\s+\w+\s*=\s*\w+|variable.*rename/i.test(text) && text.length < 500) {
      assessment = {
        behavioralChangeDetected: false,
        summary: "Pure refactor — local variable rename with no behavioral change",
        concerns: [],
        confidence: "high",
        documentationRecommendations: [],
        evidence: [{ path }],
        uncertainties: [],
        requiresHumanConfirmation: false,
      };
    } else {
      assessment = {
        behavioralChangeDetected: true,
        summary: "Code changes detected that may affect system behavior",
        concerns: ["behavior"],
        confidence: "medium",
        documentationRecommendations: [
          {
            area: "technical-overview",
            impact: "medium",
            reason: "Behavioral changes detected — technical overview may need updating",
            evidence,
          },
        ],
        evidence,
        uncertainties: ["Unable to fully determine scope of behavioral change"],
        requiresHumanConfirmation: true,
      };
    }

    return {
      assessment,
      metadata: {
        providerName: "fake",
        modelId: "fake-deterministic-v1",
        latencyMs: 0,
      },
    };
  }
}

export class HallucinatingProvider implements ReasoningProvider {
  readonly name = "hallucinating";

  async analyzeChange(input: AiReviewInput, _systemPrompt: string): Promise<ReasoningProviderResult> {
    const path = firstChangedPath(input);
    return {
      assessment: {
        behavioralChangeDetected: true,
        summary: "Changes detected with possible security implications",
        concerns: ["security"],
        confidence: "high",
        documentationRecommendations: [
          {
            area: "security",
            impact: "high",
            reason: "Security-relevant change found",
            evidence: [
              { path: "src/nonexistent/hallucinated-file.ts", startLine: 100, endLine: 200 },
              { path: "src/imaginary/another-fake.ts", startLine: 50, endLine: 75 },
            ],
          },
        ],
        evidence: [
          { path: "src/nonexistent/hallucinated-file.ts", startLine: 100, endLine: 200 },
          { path, startLine: 1, endLine: 3 },
        ],
        uncertainties: [],
        requiresHumanConfirmation: false,
      },
      metadata: { providerName: "hallucinating", modelId: "hallucinator-v1", latencyMs: 0 },
    };
  }
}

export class ConflictingProvider implements ReasoningProvider {
  readonly name = "conflicting";

  async analyzeChange(input: AiReviewInput, _systemPrompt: string): Promise<ReasoningProviderResult> {
    return {
      assessment: {
        behavioralChangeDetected: true,
        summary: "Database migration detected — postgresql schema changed",
        concerns: ["data-handling"],
        confidence: "high",
        documentationRecommendations: [
          {
            area: "data-handling",
            impact: "high",
            reason: "PostgreSQL schema migration affects data handling documentation",
            evidence: citeSuppliedEvidence(input.changedFiles),
          },
        ],
        evidence: citeSuppliedEvidence(input.changedFiles),
        uncertainties: [],
        requiresHumanConfirmation: false,
      },
      metadata: { providerName: "conflicting", modelId: "conflict-v1", latencyMs: 0 },
    };
  }
}

export class FailingProvider implements ReasoningProvider {
  readonly name = "failing";

  async analyzeChange(_input: AiReviewInput, _systemPrompt: string): Promise<ReasoningProviderResult> {
    throw new ProviderUnavailableError("failing", "Simulated provider failure for testing");
  }
}

export class TimeoutProvider implements ReasoningProvider {
  readonly name = "timeout";

  async analyzeChange(_input: AiReviewInput, _systemPrompt: string): Promise<ReasoningProviderResult> {
    throw new ProviderUnavailableError("timeout", "timed out after 60000ms");
  }
}
