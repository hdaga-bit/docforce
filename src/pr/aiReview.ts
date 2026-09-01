import type { DocforcePrConfig } from "../config/types.js";
import type { ChangeImpactReport } from "../impact/types.js";
import type { ReasoningProvider } from "../review/provider.js";
import { runAiReview } from "../review/index.js";
import { shouldSkipAiReview, shouldTriggerAiReview } from "../review/trigger.js";
import type { PrAiReviewAssessment } from "./types.js";

export interface PrAiReviewOptions {
  readonly repoRoot: string;
  readonly baseRef: string;
  readonly headRef?: string;
  readonly policy: DocforcePrConfig;
  readonly impactReport: ChangeImpactReport;
  readonly provider?: ReasoningProvider;
  readonly forceAiReview?: boolean;
}

const NOT_RUN_DEFAULTS = {
  concerns: [] as readonly string[],
  documentationAreas: [] as readonly string[],
  conflicts: [] as const,
};

/**
 * Decide whether AI review is useful for this pull request and, if so, run the
 * existing v0.5 reviewer. The trigger rules are not re-implemented here: the
 * same functions the CLI uses decide, so generated-doc-only, DocForce-internal
 * and test-only changes are skipped identically.
 */
export async function runPrAiReview(options: PrAiReviewOptions): Promise<PrAiReviewAssessment> {
  const { policy, impactReport, provider, forceAiReview } = options;

  if (!policy.aiReview.enabled) {
    return { status: "disabled", reason: "AI review is disabled by pull-request policy", ...NOT_RUN_DEFAULTS };
  }

  if (shouldSkipAiReview(impactReport)) {
    return {
      status: "not-required",
      reason: "Only generated docs, tests, or DocForce-internal files changed",
      ...NOT_RUN_DEFAULTS,
    };
  }

  const trigger = shouldTriggerAiReview(impactReport, forceAiReview ?? false);
  if (!trigger.shouldTrigger) {
    return {
      status: "not-required",
      reason: trigger.reason,
      ...NOT_RUN_DEFAULTS,
    };
  }

  if (!provider) {
    return {
      status: "unavailable",
      reason: trigger.reason,
      error:
        "No AI provider configured. Deterministic analysis is unchanged and manual review remains outstanding.",
      ...NOT_RUN_DEFAULTS,
    };
  }

  const report = await runAiReview(
    {
      baseRef: options.baseRef,
      headRef: options.headRef,
      repoRoot: options.repoRoot,
      forceAiReview,
    },
    provider,
  );

  const result = report.result;

  if (result.error || !result.assessment) {
    return {
      status: result.error?.includes("No AI provider") ? "unavailable" : "failed",
      reason: result.triggerReason ?? trigger.reason,
      providerName: result.providerMetadata?.providerName ?? provider.name,
      error: result.error ?? "AI review produced no usable assessment",
      concerns: [],
      documentationAreas: [],
      conflicts: [...result.conflicts],
    };
  }

  return {
    status: "completed",
    reason: result.triggerReason ?? trigger.reason,
    providerName: result.providerMetadata?.providerName ?? provider.name,
    behavioralChangeDetected: result.assessment.behavioralChangeDetected,
    summary: result.assessment.summary,
    concerns: [...result.assessment.concerns],
    confidence: result.assessment.confidence,
    requiresHumanConfirmation: result.assessment.requiresHumanConfirmation,
    documentationAreas: result.assessment.documentationRecommendations
      .filter((r) => r.impact !== "none")
      .map((r) => r.area),
    conflicts: [...result.conflicts],
  };
}
