import { sanitizePath, sanitizeUntrustedText } from "./sanitize.js";
import type {
  DeterministicDocStatus,
  PullRequestDocumentationAssessment,
  PullRequestDocumentationStatus,
} from "./types.js";

/** Stable marker so a comment-based reporter updates instead of duplicating. */
export const DOCFORCE_PR_MARKER = "<!-- docforce:pr-assessment -->";

const MAX_DETECTED_CHANGES = 8;

export function statusLabel(status: PullRequestDocumentationStatus): string {
  return status.replace("_", " ");
}

function docStatusLabel(status: DeterministicDocStatus): string {
  return status.toUpperCase();
}

export function renderPrSummaryTitle(assessment: PullRequestDocumentationAssessment): string {
  return `DocForce: ${statusLabel(assessment.status)}`;
}

/**
 * Concise human-readable pull-request surface.
 *
 * Deliberately much shorter than the full `.docforce/reports` output: it says
 * what changed, whether deterministic documentation is current, whether a
 * behavioural decision is outstanding, and what to run next.
 */
export function renderPrSummary(assessment: PullRequestDocumentationAssessment): string {
  const s: string[] = [];

  s.push("# DocForce Documentation Review");
  s.push("");
  s.push(`Status: ${statusLabel(assessment.status)}`);
  s.push("");

  s.push("## Product Change");
  s.push("");
  s.push(`Files changed: ${assessment.changedFiles.length}`);
  s.push("");
  s.push(`Architecture impact: ${assessment.deterministicImpact.overallImpactLevel.toUpperCase()}`);
  s.push("");

  const detected = describeDetectedChanges(assessment);
  if (detected.length > 0) {
    s.push("Detected:");
    s.push("");
    for (const line of detected) s.push(`- ${line}`);
    s.push("");
  }

  s.push("## Deterministic Documentation");
  s.push("");
  const affected = assessment.deterministicDocs.artifacts.filter((a) => a.status !== "unaffected");
  if (assessment.deterministicDocs.error) {
    s.push(`Status unavailable: ${sanitizeUntrustedText(assessment.deterministicDocs.error)}`);
    s.push("");
  } else if (affected.length === 0) {
    s.push("No deterministic artifacts are affected by this change.");
    s.push("");
  } else {
    s.push("| Artifact | Status |");
    s.push("|----------|--------|");
    for (const artifact of assessment.deterministicDocs.artifacts) {
      s.push(`| ${sanitizePath(artifact.artifact)} | ${docStatusLabel(artifact.status)} |`);
    }
    s.push("");
  }

  const updateAction = assessment.actions.find((a) => a.kind === "deterministic-update" && !a.resolved);
  if (updateAction) {
    s.push("Action:");
    s.push("");
    s.push("Run:");
    s.push("");
    s.push(`\`${updateAction.command ?? "npm run docforce:update -- --apply"}\``);
    s.push("");
    s.push("and include the resulting changes in this PR.");
    s.push("");
  }

  s.push("## Behavioral Review");
  s.push("");
  s.push(`Manual review: ${assessment.deterministicImpact.manualReviewRecommended ? "Yes" : "No"}`);
  s.push("");
  s.push(`AI review: ${aiReviewLabel(assessment)}`);
  s.push("");

  if (assessment.aiReview.status === "completed") {
    if (assessment.aiReview.summary) {
      s.push(`AI assessment: ${sanitizeUntrustedText(assessment.aiReview.summary, 400)}`);
      s.push("");
    }
    if (assessment.aiReview.concerns.length > 0) {
      s.push(`Concerns: ${assessment.aiReview.concerns.map((c) => sanitizeUntrustedText(c, 40)).join(", ")}`);
      s.push("");
    }
  }

  const manualActions = assessment.actions.filter(
    (a) => !a.resolved && (a.kind === "manual-documentation" || a.kind === "proposal-review"),
  );
  if (manualActions.length > 0) {
    s.push("Outstanding documentation decisions:");
    s.push("");
    for (const action of manualActions) {
      s.push(`- ${sanitizeUntrustedText(action.description, 200)}`);
    }
    s.push("");
  }

  if (assessment.errors.length > 0) {
    s.push("## Errors");
    s.push("");
    for (const error of assessment.errors) s.push(`- ${sanitizeUntrustedText(error)}`);
    s.push("");
  }

  s.push("## Trust");
  s.push("");
  s.push("Deterministic architecture claims are evidence-backed by the repository.");
  s.push("");
  s.push("AI interpretations, when present, are labeled separately and are not repository facts.");
  s.push("");
  s.push(`_DocForce v${assessment.docforceVersion} — assessment only. No documentation was modified._`);
  s.push("");

  return s.join("\n");
}

/** Comment body variant carrying the stable update marker. */
export function renderPrComment(assessment: PullRequestDocumentationAssessment): string {
  return `${DOCFORCE_PR_MARKER}\n${renderPrSummary(assessment)}`;
}

function aiReviewLabel(assessment: PullRequestDocumentationAssessment): string {
  switch (assessment.aiReview.status) {
    case "disabled":
      return "Disabled by policy";
    case "not-required":
      return "Not required";
    case "unavailable":
      return "Unavailable";
    case "failed":
      return "Failed";
    case "completed":
      return `Completed${assessment.aiReview.confidence ? ` (confidence: ${assessment.aiReview.confidence})` : ""}`;
    default: {
      const exhaustive: never = assessment.aiReview.status;
      return exhaustive;
    }
  }
}

function describeDetectedChanges(assessment: PullRequestDocumentationAssessment): string[] {
  const lines: string[] = [];

  for (const change of assessment.deterministicImpact.entityChanges) {
    const verb = change.changeType === "added" ? "new" : change.changeType === "removed" ? "removed" : "changed";
    lines.push(`${verb} ${singularDomain(change.domain)} ${sanitizeUntrustedText(change.name, 80)}`);
    if (lines.length >= MAX_DETECTED_CHANGES) return lines;
  }

  for (const rel of assessment.deterministicImpact.relationshipChanges) {
    lines.push(
      `${rel.changeType === "added" ? "new" : "removed"} dependency ${sanitizeUntrustedText(rel.from, 40)} → ${sanitizeUntrustedText(rel.to, 40)}`,
    );
    if (lines.length >= MAX_DETECTED_CHANGES) return lines;
  }

  return lines;
}

function singularDomain(domain: string): string {
  switch (domain) {
    case "technologies":
      return "technology";
    case "components":
      return "component";
    case "integrations":
      return "integration";
    case "datastores":
      return "datastore";
    case "infrastructure":
      return "infrastructure";
    case "relationships":
      return "relationship";
    case "workflows":
      return "workflow";
    default:
      return domain;
  }
}
