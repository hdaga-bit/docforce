import { WriterDraftSchema } from "./types.js";
import type { WriterDraft, DocumentationDraftInput, AiDocumentationProposal } from "./types.js";
import type { AiReviewInput } from "../review/types.js";
import { validateAiResponse } from "../review/responseValidator.js";
import { isDeterministicOwnedPath, isPathWithinAllowedRoots } from "./ownership.js";
import type { DocforceConfig } from "../config/types.js";
import { hashContent, isProposalStale } from "./sections.js";
import { detectConflicts } from "../review/conflictDetector.js";
import type { SystemModel } from "../model/types.js";

export interface ProposalValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly draft?: WriterDraft;
  readonly stale: boolean;
}

export function validateWriterDraft(
  raw: unknown,
  input: DocumentationDraftInput,
  config: DocforceConfig,
  repoRoot: string,
  model: SystemModel,
  options: { expectedOldHash?: string } = {},
): ProposalValidationResult {
  const errors: string[] = [];
  const parsed = WriterDraftSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      stale: false,
    };
  }

  const draft = parsed.data;

  if (draft.proposedContent.includes("docforce:ai-section")) {
    errors.push("Proposed content must not include DocForce section markers");
  }

  const targetPath = input.target.path.replace(/\\/g, "/");
  if (targetPath.includes("..") || targetPath.startsWith("/") || targetPath.startsWith("~")) {
    errors.push(`Target path "${targetPath}" is unsafe`);
  }
  if (!isPathWithinAllowedRoots(repoRoot, targetPath, config.documentation.allowedRoots)) {
    errors.push(`Target path "${targetPath}" is outside allowed documentation roots`);
  }
  if (isDeterministicOwnedPath(targetPath, config)) {
    errors.push(`Target path "${targetPath}" is deterministic-owned and cannot receive AI proposals`);
  }

  if (!input.sectionExists && !input.target.allowCreateSection) {
    errors.push(`Section "${input.target.sectionId}" does not exist and creation is not permitted`);
  }

  const asReviewInput: AiReviewInput = {
    changedFiles: input.changedFiles,
    impactReport: {
      overallImpactLevel: "none",
      manualReviewRecommended: true,
      changedDomains: [],
    },
    affectedComponents: [],
    relevantModelFacts: input.relevantModelFacts,
    totalFilesAvailable: input.changedFiles.length,
    truncationApplied: input.truncationApplied,
  };

  const evidenceCheck = validateAiResponse(
    {
      behavioralChangeDetected: true,
      summary: draft.summaryOfChange,
      concerns: ["behavior"],
      confidence: draft.confidence,
      documentationRecommendations: [{
        area: input.area,
        impact: "medium",
        reason: draft.summaryOfChange,
        evidence: draft.evidence,
      }],
      evidence: draft.evidence,
      uncertainties: draft.uncertainties,
      requiresHumanConfirmation: true,
    },
    asReviewInput,
  );

  if (!evidenceCheck.valid || evidenceCheck.evidenceDowngraded
      || (evidenceCheck.assessment?.evidence.length ?? 0) !== draft.evidence.length) {
    errors.push("Proposal evidence references are invalid (missing from supplied context, unsafe path, or bad line range)");
  }

  if (draft.evidence.length === 0) {
    errors.push("Proposal-level evidence is mandatory");
  }

  if ((input.recommendationImpact === "high" || input.recommendationImpact === "medium")
      && draft.confidence === "high" && input.truncationApplied) {
    errors.push("Confidence cannot be high when review context was truncated");
  }

  const unchanged = draft.proposedContent === (input.existingSectionContent ?? "");
  if (!unchanged && draft.proposedContent.trim().length === 0) {
    errors.push("Proposed content is empty");
  }

  const fakeAssessment = {
    behavioralChangeDetected: true,
    summary: draft.proposedContent,
    concerns: ["data-handling" as const],
    confidence: draft.confidence,
    documentationRecommendations: [{
      area: "data-handling" as const,
      impact: "medium" as const,
      reason: draft.proposedContent,
      evidence: draft.evidence,
    }],
    evidence: draft.evidence,
    uncertainties: draft.uncertainties,
    requiresHumanConfirmation: true,
  };
  const conflicts = detectConflicts(fakeAssessment, model);
  for (const c of conflicts) {
    errors.push(`Deterministic conflict: ${c.deterministicFact} vs ${c.aiClaim}`);
  }
  errors.push(...detectNegationConflicts(draft.proposedContent, model));

  const expectedOld = options.expectedOldHash;
  const isStale = expectedOld !== undefined
    ? isProposalStale(expectedOld, input.existingSectionContent)
    : false;
  if (isStale) {
    errors.push("Stale proposal baseline: current section hash does not match oldContentHash");
  }

  return {
    valid: errors.length === 0,
    errors,
    draft: errors.length === 0 ? draft : undefined,
    stale: isStale,
  };
}

export function isProposalStaleAgainstFile(
  proposal: Pick<AiDocumentationProposal, "oldContentHash">,
  currentSectionContent: string | undefined,
): boolean {
  return isProposalStale(proposal.oldContentHash, currentSectionContent);
}

function detectNegationConflicts(text: string, model: SystemModel): string[] {
  const errors: string[] = [];
  const lower = text.toLowerCase();
  for (const integ of model.integrations) {
    const name = integ.name.toLowerCase();
    const denies = new RegExp(`no ${name}|does not (use|have|include) ${name}|without ${name}`, "i");
    if (denies.test(lower)) {
      errors.push(`Deterministic conflict: integration "${integ.name}" exists but proposal denies it`);
    }
  }
  for (const ds of model.datastores) {
    const name = ds.name.toLowerCase();
    const denies = new RegExp(`no ${name}|does not (use|have|store).{0,20}${name}`, "i");
    if (denies.test(lower)) {
      errors.push(`Deterministic conflict: datastore "${ds.name}" exists but proposal denies it`);
    }
  }
  return errors;
}
