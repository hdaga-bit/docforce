import type { ChangeImpactReport } from "../impact/types.js";
import { classifyFileChanges } from "../impact/fileClassifier.js";

export interface TriggerResult {
  readonly shouldTrigger: boolean;
  readonly reason: string;
}

export function shouldTriggerAiReview(
  impactReport: ChangeImpactReport,
  forceReview: boolean,
): TriggerResult {
  if (forceReview) {
    return { shouldTrigger: true, reason: "Explicitly requested via --ai-review" };
  }

  if (impactReport.manualReviewRecommended) {
    return {
      shouldTrigger: true,
      reason: impactReport.manualReviewReason ?? "Deterministic analysis recommends manual review",
    };
  }

  const classified = classifyFileChanges(impactReport.fileChanges);
  const sourceChanges = classified.filter((f) => f.category === "source");
  const hasSourceChanges = sourceChanges.length > 0;
  const noModelDelta = impactReport.modelDelta.isEmpty;

  if (hasSourceChanges && noModelDelta && impactReport.overallImpactLevel === "none") {
    return {
      shouldTrigger: true,
      reason: "Source files changed without model delta — behavioral change possible",
    };
  }

  return { shouldTrigger: false, reason: "No AI review trigger conditions met" };
}

export function shouldSkipAiReview(
  impactReport: ChangeImpactReport,
): boolean {
  const classified = classifyFileChanges(impactReport.fileChanges);
  const hasProductRelevant = classified.some((f) =>
    f.category === "source" || f.category === "configuration" || f.category === "infrastructure"
  );
  return !hasProductRelevant;
}
