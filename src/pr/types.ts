import type { DocforcePrConfig } from "../config/types.js";
import type { ChangeType, FileCategory, ImpactLevel, ModelDomain } from "../impact/index.js";

/**
 * Overall documentation status for a pull request.
 *
 * PASS
 *   No documentation impact, or every affected deterministic artifact is
 *   already current in the pull request and no unresolved AI/manual concern
 *   remains.
 *
 * REVIEW
 *   Deterministic documentation is current, but a behavioural or manual
 *   documentation decision is outstanding — including the case where AI
 *   review was recommended but could not run.
 *
 * ACTION_REQUIRED
 *   Deterministic documentation is stale or missing, or a required
 *   documentation action remains unresolved.
 *
 * ERROR
 *   DocForce could not reliably complete the assessment.
 */
export const PR_DOCUMENTATION_STATUSES = ["PASS", "REVIEW", "ACTION_REQUIRED", "ERROR"] as const;
export type PullRequestDocumentationStatus = (typeof PR_DOCUMENTATION_STATUSES)[number];

/**
 * Per-artifact deterministic documentation state.
 *
 * unaffected — the product change does not touch the model domains this
 *              artifact depends on.
 * current    — the artifact is affected and the version in the pull request
 *              already matches what DocForce would regenerate.
 * stale      — the artifact is affected and the version in the pull request
 *              differs from the regenerated content.
 * missing    — the artifact is affected and does not exist in the pull request.
 */
export const DETERMINISTIC_DOC_STATUSES = ["unaffected", "current", "stale", "missing"] as const;
export type DeterministicDocStatus = (typeof DETERMINISTIC_DOC_STATUSES)[number];

export interface DeterministicArtifactAssessment {
  readonly artifact: string;
  readonly path: string;
  readonly status: DeterministicDocStatus;
  readonly impactLevel: ImpactLevel;
  readonly triggeringDomains: readonly ModelDomain[];
  readonly reason: string;
}

export interface DeterministicDocumentationAssessment {
  readonly artifacts: readonly DeterministicArtifactAssessment[];
  readonly affectedCount: number;
  readonly staleCount: number;
  readonly missingCount: number;
  /** True when no affected artifact is stale or missing. */
  readonly upToDate: boolean;
  /** Populated when artifact currency could not be determined. */
  readonly error?: string;
}

/**
 * disabled     — PR policy turned AI review off.
 * not-required — v0.5 trigger rules say AI review adds nothing here.
 * unavailable  — AI review was warranted but no provider could run it.
 * failed       — a provider ran and returned an unusable result.
 * completed    — a provider returned a schema-valid assessment.
 */
export const PR_AI_REVIEW_STATUSES = [
  "disabled",
  "not-required",
  "unavailable",
  "failed",
  "completed",
] as const;
export type PrAiReviewStatus = (typeof PR_AI_REVIEW_STATUSES)[number];

export interface PrAiConflict {
  readonly field: string;
  readonly deterministicFact: string;
  readonly aiClaim: string;
  readonly resolution: string;
}

export interface PrAiReviewAssessment {
  readonly status: PrAiReviewStatus;
  readonly reason: string;
  readonly providerName?: string;
  readonly behavioralChangeDetected?: boolean;
  readonly summary?: string;
  readonly concerns: readonly string[];
  readonly confidence?: string;
  readonly requiresHumanConfirmation?: boolean;
  readonly documentationAreas: readonly string[];
  readonly conflicts: readonly PrAiConflict[];
  readonly error?: string;
}

/**
 * no-proposal-needed     — nothing recommends an AI-assisted documentation change.
 * proposal-recommended   — a documentation area was recommended and a registered
 *                          target exists, but no proposal has been generated.
 * proposal-generated     — a stored proposal exists and would apply cleanly.
 * proposal-stale         — a stored proposal no longer matches the repository.
 * proposal-applied       — an approval record shows the proposal was applied.
 * manual-target-required — the recommended area has no registered target, so a
 *                          human must decide where the documentation lives.
 */
export const PR_PROPOSAL_STATES = [
  "no-proposal-needed",
  "proposal-recommended",
  "proposal-generated",
  "proposal-stale",
  "proposal-applied",
  "manual-target-required",
] as const;
export type PrProposalState = (typeof PR_PROPOSAL_STATES)[number];

export interface PrProposalAssessment {
  readonly state: PrProposalState;
  readonly area?: string;
  readonly proposalId?: string;
  readonly targetPath?: string;
  readonly sectionId?: string;
  readonly detail: string;
  /** True only when an approval/application record exists on disk. */
  readonly approvalRecordFound: boolean;
}

export const PR_ACTION_KINDS = [
  "deterministic-update",
  "behavioral-review",
  "manual-documentation",
  "proposal-review",
] as const;
export type PrActionKind = (typeof PR_ACTION_KINDS)[number];

export interface PrDocumentationAction {
  readonly kind: PrActionKind;
  readonly description: string;
  /** Suggested command for a human to run locally. Never executed by DocForce. */
  readonly command?: string;
  readonly resolved: boolean;
}

export interface PrChangedFile {
  readonly path: string;
  readonly changeType: ChangeType;
  readonly category: FileCategory;
}

export interface PrIdentity {
  /** owner/name, when known. Absent for local previews. */
  readonly repository?: string;
  readonly number?: number;
  readonly baseRef: string;
  readonly baseSha?: string;
  readonly headRef: string;
  readonly headSha?: string;
  /** True when the head repository differs from the base repository. */
  readonly fromFork: boolean;
}

export interface PrDeterministicImpact {
  readonly overallImpactLevel: ImpactLevel;
  readonly changedDomains: readonly ModelDomain[];
  readonly entityChanges: readonly { domain: ModelDomain; changeType: ChangeType; name: string }[];
  readonly relationshipChanges: readonly { changeType: ChangeType; from: string; to: string; type: string }[];
  readonly manualReviewRecommended: boolean;
  readonly manualReviewReason?: string;
}

/**
 * Provider-neutral result of a pull-request documentation assessment.
 *
 * Contains no GitHub types and records no side effects: reporters consume it,
 * they do not shape it.
 */
export interface PullRequestDocumentationAssessment {
  readonly generatedAt: string;
  readonly docforceVersion: string;
  readonly pullRequest: PrIdentity;
  readonly changedFiles: readonly PrChangedFile[];
  readonly productRelevantFileCount: number;
  readonly deterministicImpact: PrDeterministicImpact;
  readonly deterministicDocs: DeterministicDocumentationAssessment;
  readonly aiReview: PrAiReviewAssessment;
  readonly proposals: readonly PrProposalAssessment[];
  readonly actions: readonly PrDocumentationAction[];
  readonly unresolvedActionCount: number;
  readonly status: PullRequestDocumentationStatus;
  readonly statusReasons: readonly string[];
  readonly policy: DocforcePrConfig;
  readonly errors: readonly string[];
}

export interface PrReportingOutcome {
  readonly reporter: string;
  readonly attempted: boolean;
  readonly published: boolean;
  readonly skippedReason?: string;
  readonly error?: string;
}

export interface PullRequestCheckResult {
  readonly assessment: PullRequestDocumentationAssessment;
  readonly reporting: PrReportingOutcome;
  readonly localReport?: { readonly mdPath: string; readonly jsonPath: string };
}
