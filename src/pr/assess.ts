import { DEFAULT_PR_CONFIG, loadConfig, resolveConfigPath } from "../config/index.js";
import type { DocforcePrConfig } from "../config/types.js";
import { analyzeChangeImpact } from "../impact/index.js";
import { classifyFileChanges, getProductRelevantChanges } from "../impact/fileClassifier.js";
import { resolveRef } from "../impact/gitComparison.js";
import { scanAtRef, scanWorkingTree } from "../impact/worktree.js";
import type { ReasoningProvider } from "../review/provider.js";
import { DOCFORCE_VERSION } from "../version.js";
import { runPrAiReview } from "./aiReview.js";
import { assessDeterministicDocs, createArtifactReader, summarize } from "./deterministicDocs.js";
import { assessProposals } from "./proposals.js";
import { computeOverallStatus } from "./status.js";
import type {
  PrAiReviewAssessment,
  PrChangedFile,
  PrIdentity,
  PrProposalAssessment,
  PullRequestDocumentationAssessment,
} from "./types.js";

export interface PullRequestAssessmentInput {
  readonly repoRoot: string;
  readonly baseRef: string;
  /** Omit to assess the working tree as head (local preview). */
  readonly headRef?: string;
  /** Provider-neutral identity supplied by an adapter. */
  readonly identity?: {
    readonly repository?: string;
    readonly number?: number;
    readonly baseRefName?: string;
    readonly headRefName?: string;
    readonly fromFork?: boolean;
  };
  /** Overrides the policy loaded from docforce.yml. Intended for tests. */
  readonly policy?: DocforcePrConfig;
  readonly provider?: ReasoningProvider;
  readonly forceAiReview?: boolean;
}

/**
 * Produce a structured pull-request documentation assessment.
 *
 * Pure analysis: no documentation is written, no proposal is applied, no Git
 * state is modified, and nothing GitHub-specific is touched. Adapters supply
 * identity and consume the result.
 */
export async function assessPullRequest(
  input: PullRequestAssessmentInput,
): Promise<PullRequestDocumentationAssessment> {
  const { repoRoot, baseRef, headRef } = input;
  const generatedAt = new Date().toISOString();

  let policy: DocforcePrConfig;
  let config;
  try {
    config = loadConfig(resolveConfigPath(repoRoot));
    policy = input.policy ?? config.pr;
  } catch (err) {
    return errorAssessment(input, generatedAt, `Configuration could not be loaded: ${(err as Error).message}`);
  }

  let impactReport;
  try {
    impactReport = analyzeChangeImpact({ baseRef, headRef, repoRoot });
  } catch (err) {
    return errorAssessment(input, generatedAt, `Change impact analysis failed: ${(err as Error).message}`, policy);
  }

  const classified = classifyFileChanges(impactReport.fileChanges);
  const changedFiles: PrChangedFile[] = classified.map((f) => ({
    path: f.path,
    changeType: f.changeType,
    category: f.category,
  }));
  const productRelevantFileCount = getProductRelevantChanges(classified).length;

  let deterministicDocs;
  try {
    const headModel = headRef ? scanAtRef(repoRoot, headRef) : scanWorkingTree(repoRoot);
    deterministicDocs = assessDeterministicDocs({
      config,
      headModel,
      impactReport,
      readArtifact: createArtifactReader(repoRoot, headRef),
    });
  } catch (err) {
    return errorAssessment(
      input,
      generatedAt,
      `Deterministic documentation status could not be determined: ${(err as Error).message}`,
      policy,
    );
  }

  let aiReview: PrAiReviewAssessment;
  try {
    aiReview = await runPrAiReview({
      repoRoot,
      baseRef,
      headRef,
      policy,
      impactReport,
      provider: input.provider,
      forceAiReview: input.forceAiReview,
    });
  } catch (err) {
    // A reviewer crash must not invalidate deterministic analysis.
    aiReview = {
      status: "failed",
      reason: "AI review raised an unexpected error",
      error: (err as Error).message,
      concerns: [],
      documentationAreas: [],
      conflicts: [],
    };
  }

  let proposals: PrProposalAssessment[];
  try {
    proposals = assessProposals({
      repoRoot,
      config,
      recommendedAreas: aiReview.documentationAreas,
    });
  } catch (err) {
    proposals = [];
    aiReview = {
      ...aiReview,
      error: [aiReview.error, `Proposal state unavailable: ${(err as Error).message}`]
        .filter(Boolean)
        .join("; "),
    };
  }

  const { status, reasons, actions } = computeOverallStatus({
    policy,
    deterministicDocs,
    manualReviewRecommended: impactReport.manualReviewRecommended,
    manualReviewReason: impactReport.manualReviewReason,
    aiReview,
    proposals,
    errors: [],
  });

  return {
    generatedAt,
    docforceVersion: DOCFORCE_VERSION,
    pullRequest: buildIdentity(input, impactReport.baseRef, impactReport.headRef),
    changedFiles,
    productRelevantFileCount,
    deterministicImpact: {
      overallImpactLevel: impactReport.overallImpactLevel,
      changedDomains: [...impactReport.modelDelta.changedDomains],
      entityChanges: impactReport.modelDelta.entityChanges.map((e) => ({
        domain: e.domain,
        changeType: e.changeType,
        name: e.name,
      })),
      relationshipChanges: impactReport.modelDelta.relationshipChanges.map((r) => ({
        changeType: r.changeType,
        from: r.from,
        to: r.to,
        type: r.type,
      })),
      manualReviewRecommended: impactReport.manualReviewRecommended,
      manualReviewReason: impactReport.manualReviewReason,
    },
    deterministicDocs,
    aiReview,
    proposals,
    actions,
    unresolvedActionCount: actions.filter((a) => !a.resolved).length,
    status,
    statusReasons: reasons,
    policy,
    errors: [],
  };
}

function buildIdentity(
  input: PullRequestAssessmentInput,
  resolvedBaseLabel: string,
  resolvedHeadLabel: string,
): PrIdentity {
  const baseSha = resolveRef(input.repoRoot, input.baseRef) ?? undefined;
  const headSha = input.headRef
    ? (resolveRef(input.repoRoot, input.headRef) ?? undefined)
    : (resolveRef(input.repoRoot, "HEAD") ?? undefined);

  return {
    repository: input.identity?.repository,
    number: input.identity?.number,
    baseRef: input.identity?.baseRefName ?? resolvedBaseLabel,
    baseSha,
    headRef: input.identity?.headRefName ?? resolvedHeadLabel,
    headSha,
    fromFork: input.identity?.fromFork ?? false,
  };
}

function errorAssessment(
  input: PullRequestAssessmentInput,
  generatedAt: string,
  message: string,
  policy?: DocforcePrConfig,
): PullRequestDocumentationAssessment {
  const effectivePolicy = policy ?? input.policy ?? DEFAULT_PR_CONFIG;

  return {
    generatedAt,
    docforceVersion: DOCFORCE_VERSION,
    pullRequest: {
      repository: input.identity?.repository,
      number: input.identity?.number,
      baseRef: input.identity?.baseRefName ?? input.baseRef,
      headRef: input.identity?.headRefName ?? input.headRef ?? "WORKTREE",
      fromFork: input.identity?.fromFork ?? false,
    },
    changedFiles: [],
    productRelevantFileCount: 0,
    deterministicImpact: {
      overallImpactLevel: "none",
      changedDomains: [],
      entityChanges: [],
      relationshipChanges: [],
      manualReviewRecommended: false,
    },
    deterministicDocs: summarize([], message),
    aiReview: {
      status: "not-required",
      reason: "Assessment did not reach AI review",
      concerns: [],
      documentationAreas: [],
      conflicts: [],
    },
    proposals: [],
    actions: [],
    unresolvedActionCount: 0,
    status: "ERROR",
    statusReasons: [`DocForce could not complete the assessment: ${message}`],
    policy: effectivePolicy,
    errors: [message],
  };
}
