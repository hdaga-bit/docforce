import type { DocforcePrConfig, PrStatusOutcome } from "../config/types.js";
import type {
  DeterministicDocumentationAssessment,
  PrAiReviewAssessment,
  PrDocumentationAction,
  PrProposalAssessment,
  PullRequestDocumentationStatus,
} from "./types.js";

const SEVERITY: Record<PullRequestDocumentationStatus, number> = {
  PASS: 0,
  REVIEW: 1,
  ACTION_REQUIRED: 2,
  ERROR: 3,
};

export function escalate(
  current: PullRequestDocumentationStatus,
  candidate: PullRequestDocumentationStatus,
): PullRequestDocumentationStatus {
  return SEVERITY[candidate] > SEVERITY[current] ? candidate : current;
}

export function outcomeToStatus(outcome: PrStatusOutcome): PullRequestDocumentationStatus {
  switch (outcome) {
    case "pass":
      return "PASS";
    case "review":
      return "REVIEW";
    case "action-required":
      return "ACTION_REQUIRED";
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

export interface StatusInput {
  readonly policy: DocforcePrConfig;
  readonly deterministicDocs: DeterministicDocumentationAssessment;
  readonly manualReviewRecommended: boolean;
  readonly manualReviewReason?: string;
  readonly aiReview: PrAiReviewAssessment;
  readonly proposals: readonly PrProposalAssessment[];
  readonly errors: readonly string[];
}

export interface StatusResult {
  readonly status: PullRequestDocumentationStatus;
  readonly reasons: readonly string[];
  readonly actions: readonly PrDocumentationAction[];
}

/**
 * Single place where PR documentation status is decided.
 *
 * The rules are additive and escalate monotonically: a later rule can raise
 * severity but never lower it. In particular, an outstanding behavioural
 * review is never downgraded to PASS just because the architecture model
 * did not change.
 */
export function computeOverallStatus(input: StatusInput): StatusResult {
  const reasons: string[] = [];
  const actions: PrDocumentationAction[] = [];
  let status: PullRequestDocumentationStatus = "PASS";

  if (input.errors.length > 0) {
    return {
      status: "ERROR",
      reasons: input.errors.map((e) => `DocForce could not complete the assessment: ${e}`),
      actions: [],
    };
  }

  status = applyDeterministicRule(input, reasons, actions, status);
  status = applyProposalRules(input, reasons, actions, status);
  status = applyBehavioralRules(input, reasons, actions, status);

  if (status === "PASS" && reasons.length === 0) {
    reasons.push(
      input.deterministicDocs.affectedCount === 0
        ? "No documentation impact detected for this change."
        : "All affected deterministic documentation is current and no documentation concern is outstanding.",
    );
  }

  return { status, reasons, actions };
}

function applyDeterministicRule(
  input: StatusInput,
  reasons: string[],
  actions: PrDocumentationAction[],
  status: PullRequestDocumentationStatus,
): PullRequestDocumentationStatus {
  const { staleCount, missingCount } = input.deterministicDocs;
  if (staleCount + missingCount === 0) return status;

  const parts: string[] = [];
  if (staleCount > 0) parts.push(`${staleCount} stale`);
  if (missingCount > 0) parts.push(`${missingCount} missing`);
  const detail = `Deterministic documentation is not current in this pull request (${parts.join(", ")}).`;

  // When the repository opts out of requiring current deterministic docs we
  // still surface it for a human rather than silently passing.
  const outcome: PrStatusOutcome = input.policy.requireDeterministicDocsCurrent
    ? input.policy.statusPolicy.deterministicStale
    : "review";

  reasons.push(detail);
  actions.push({
    kind: "deterministic-update",
    description: "Regenerate the deterministic documentation and include the result in this pull request.",
    command: "npm run docforce:update -- --base <base> --apply",
    resolved: false,
  });

  return escalate(status, outcomeToStatus(outcome));
}

function applyProposalRules(
  input: StatusInput,
  reasons: string[],
  actions: PrDocumentationAction[],
  status: PullRequestDocumentationStatus,
): PullRequestDocumentationStatus {
  let next = status;

  for (const proposal of input.proposals) {
    switch (proposal.state) {
      case "proposal-stale": {
        reasons.push(`AI documentation proposal ${proposal.proposalId ?? ""} is stale: ${proposal.detail}`.trim());
        actions.push({
          kind: "proposal-review",
          description: "Regenerate and review the stale AI documentation proposal, or discard it.",
          command: "npm run docforce:draft -- --base <base>",
          resolved: false,
        });
        next = escalate(next, outcomeToStatus(input.policy.statusPolicy.manualReview));
        break;
      }
      case "proposal-generated": {
        reasons.push(`AI documentation proposal ${proposal.proposalId ?? ""} is awaiting human review.`.trim());
        actions.push({
          kind: "proposal-review",
          description: "Review the pending AI documentation proposal and decide whether to apply it.",
          command: "npm run docforce:apply-proposal -- --proposal <id>",
          resolved: false,
        });
        next = escalate(next, outcomeToStatus(input.policy.statusPolicy.manualReview));
        break;
      }
      case "manual-target-required": {
        reasons.push(
          `Documentation area "${proposal.area ?? "unknown"}" has no registered target — a manual documentation decision is required.`,
        );
        actions.push({
          kind: "manual-documentation",
          description: `Decide where documentation for "${proposal.area ?? "unknown"}" belongs, or register an AI-assisted target.`,
          resolved: false,
        });
        next = escalate(next, outcomeToStatus(input.policy.statusPolicy.manualReview));
        break;
      }
      case "proposal-recommended": {
        reasons.push(
          `Documentation area "${proposal.area ?? "unknown"}" was recommended for an AI-assisted update; no proposal has been generated.`,
        );
        actions.push({
          kind: "manual-documentation",
          description: `Generate and review a documentation proposal for "${proposal.area ?? "unknown"}".`,
          command: "npm run docforce:draft -- --base <base>",
          resolved: false,
        });
        next = escalate(next, outcomeToStatus(input.policy.statusPolicy.manualReview));
        break;
      }
      case "proposal-applied": {
        actions.push({
          kind: "proposal-review",
          description: `Proposal ${proposal.proposalId ?? ""} was applied and recorded.`.trim(),
          resolved: true,
        });
        break;
      }
      case "no-proposal-needed":
        break;
      default: {
        const exhaustive: never = proposal.state;
        return exhaustive;
      }
    }
  }

  return next;
}

function applyBehavioralRules(
  input: StatusInput,
  reasons: string[],
  actions: PrDocumentationAction[],
  status: PullRequestDocumentationStatus,
): PullRequestDocumentationStatus {
  let next = status;

  if (!input.policy.behavioralReview.enabled) return next;

  const manualReviewOutcome = outcomeToStatus(input.policy.statusPolicy.manualReview);

  if (input.manualReviewRecommended) {
    reasons.push(
      input.manualReviewReason
        ?? "Deterministic analysis recommends a manual behavioural documentation review.",
    );
    actions.push({
      kind: "behavioral-review",
      description: "Confirm whether this behavioural change needs documentation.",
      resolved: false,
    });
    next = escalate(next, manualReviewOutcome);
  }

  if (input.aiReview.behavioralChangeDetected === true) {
    reasons.push(
      `AI review reports a behavioural change${input.aiReview.concerns.length > 0 ? ` (${input.aiReview.concerns.join(", ")})` : ""}.`,
    );
    if (!actions.some((a) => a.kind === "behavioral-review")) {
      actions.push({
        kind: "behavioral-review",
        description: "Review the AI behavioural assessment and decide on documentation.",
        resolved: false,
      });
    }
    next = escalate(next, manualReviewOutcome);
  }

  if (input.aiReview.conflicts.length > 0) {
    reasons.push(
      "AI review conflicts with deterministic facts; the deterministic fact was retained and a human should confirm.",
    );
    next = escalate(next, manualReviewOutcome);
  }

  // Never let a missing AI provider turn an outstanding behavioural question
  // into a silent PASS.
  const aiCouldNotRun = input.aiReview.status === "unavailable" || input.aiReview.status === "failed";
  if (aiCouldNotRun && input.manualReviewRecommended) {
    reasons.push(
      "AI review was recommended but unavailable while manual review is outstanding; status kept conservative.",
    );
    next = escalate(
      next,
      outcomeToStatus(input.policy.statusPolicy.aiUnavailableWhenManualReviewRequired),
    );
  }

  return next;
}
