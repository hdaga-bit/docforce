import { analyzeChangeImpact } from "../impact/index.js";
import { scanWorkingTree } from "../impact/worktree.js";
import type { ReviewOptions, AiReviewResult, AiReviewReport, DeterministicReviewContext } from "./types.js";
import type { ChangeImpactReport } from "../impact/types.js";
import type { ReasoningProvider } from "./provider.js";
import { shouldTriggerAiReview, shouldSkipAiReview } from "./trigger.js";
import { collectContext } from "./contextCollector.js";
import { buildSystemPrompt } from "./prompt.js";
import { validateAiResponse } from "./responseValidator.js";
import { detectConflicts } from "./conflictDetector.js";
import { writeReviewReports } from "./reportGenerator.js";
import { DOCFORCE_VERSION } from "../version.js";

export async function runAiReview(
  options: ReviewOptions,
  provider?: ReasoningProvider,
): Promise<AiReviewReport> {
  const { baseRef, headRef, repoRoot, forceAiReview, limits } = options;

  const impactReport = analyzeChangeImpact({ baseRef, headRef, repoRoot });
  const headLabel = headRef ?? "WORKTREE";
  const deterministic = buildDeterministicContext(impactReport);

  const makeReport = (result: AiReviewResult): AiReviewReport => ({
    generatedAt: new Date().toISOString(),
    docforceVersion: DOCFORCE_VERSION,
    baseRef: impactReport.baseRef,
    headRef: headLabel,
    deterministic,
    result,
  });

  if (shouldSkipAiReview(impactReport)) {
    const report = makeReport({
      triggered: false,
      triggerReason: "Only generated docs, tests, or DocForce-internal files changed",
      conflicts: [],
      validationPassed: true,
      validationErrors: [],
      evidenceDowngraded: false,
    });
    writeReviewReports(report, repoRoot);
    return report;
  }

  const triggerResult = shouldTriggerAiReview(impactReport, forceAiReview ?? false);

  if (!triggerResult.shouldTrigger) {
    const report = makeReport({
      triggered: false,
      triggerReason: triggerResult.reason,
      conflicts: [],
      validationPassed: true,
      validationErrors: [],
      evidenceDowngraded: false,
    });
    writeReviewReports(report, repoRoot);
    return report;
  }

  if (!provider) {
    const report = makeReport({
      triggered: true,
      triggerReason: triggerResult.reason,
      conflicts: [],
      validationPassed: true,
      validationErrors: [],
      evidenceDowngraded: false,
      error: "No AI provider configured. Deterministic analysis is unchanged. Install a Claude Code CLI (`claude` on PATH) or set DOCFORCE_AI_PROVIDER=fake for tests.",
    });
    writeReviewReports(report, repoRoot);
    return report;
  }

  const model = scanWorkingTree(repoRoot);
  const context = collectContext(repoRoot, impactReport, model, limits);
  const systemPrompt = buildSystemPrompt();

  let result: AiReviewResult;

  try {
    const providerResult = await provider.analyzeChange(context, systemPrompt);

    const validation = validateAiResponse(providerResult.assessment, context);

    if (!validation.valid) {
      result = {
        triggered: true,
        triggerReason: triggerResult.reason,
        conflicts: [],
        validationPassed: false,
        validationErrors: validation.errors,
        evidenceDowngraded: false,
        providerMetadata: providerResult.metadata,
        error: "AI response failed schema validation. Deterministic analysis is unchanged.",
      };
    } else {
      const conflicts = detectConflicts(validation.assessment!, model);
      result = {
        triggered: true,
        triggerReason: triggerResult.reason,
        assessment: validation.assessment,
        conflicts,
        validationPassed: true,
        validationErrors: [...validation.errors],
        evidenceDowngraded: validation.evidenceDowngraded,
        providerMetadata: providerResult.metadata,
      };
    }
  } catch (err) {
    result = {
      triggered: true,
      triggerReason: triggerResult.reason,
      conflicts: [],
      validationPassed: true,
      validationErrors: [],
      evidenceDowngraded: false,
      error: `AI provider failed: ${(err as Error).message}`,
    };
  }

  const report = makeReport(result);
  writeReviewReports(report, repoRoot);
  return report;
}

function buildDeterministicContext(impactReport: ChangeImpactReport): DeterministicReviewContext {
  const changedComponents = [...new Set(
    impactReport.fileChanges
      .map((fc) => fc.path.replace(/\\/g, "/").match(/^src\/([^/]+)/)?.[1])
      .filter((c): c is string => Boolean(c) && c !== "docforce"),
  )];

  return {
    overallImpactLevel: impactReport.overallImpactLevel,
    manualReviewRecommended: impactReport.manualReviewRecommended,
    manualReviewReason: impactReport.manualReviewReason,
    changedDomains: [...impactReport.modelDelta.changedDomains],
    changedComponents,
    changedFiles: impactReport.fileChanges.map((fc) => fc.path),
  };
}
