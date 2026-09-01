import { z } from "zod";
import {
  DOCUMENTATION_AREAS,
  AI_CONFIDENCE_LEVELS,
  AiEvidenceReferenceSchema,
} from "../review/types.js";
import type { AiEvidenceReference, DocumentationArea, AiConfidence } from "../review/types.js";
import type { FileContext } from "../review/types.js";
import type { AiChangeAssessment } from "../review/types.js";
import type { ChangeImpactReport } from "../impact/types.js";
import type { DocforceAiAssistedTarget } from "../config/types.js";

export const PROPOSAL_OPERATIONS = ["create-section", "update-section", "no-change"] as const;
export type ProposalOperation = (typeof PROPOSAL_OPERATIONS)[number];

export const WriterDraftSchema = z.object({
  title: z.string().min(1),
  proposedContent: z.string(),
  summaryOfChange: z.string().min(1),
  confidence: z.enum(AI_CONFIDENCE_LEVELS),
  evidence: z.array(AiEvidenceReferenceSchema),
  interpretationsUsed: z.array(z.string()),
  assumptions: z.array(z.string()),
  uncertainties: z.array(z.string()),
});
export type WriterDraft = z.infer<typeof WriterDraftSchema>;

export interface AiDocumentationProposal {
  readonly id: string;
  readonly proposalId: string;
  readonly createdAt: string;
  readonly proposalFingerprint: string;
  readonly modelFingerprint: string;
  readonly baseRef: string;
  readonly headRef: string;
  readonly area: DocumentationArea;
  readonly targetPath: string;
  readonly sectionId: string;
  readonly operation: ProposalOperation;
  readonly title: string;
  readonly proposedContent: string;
  readonly summaryOfChange: string;
  readonly confidence: AiConfidence;
  readonly evidence: readonly AiEvidenceReference[];
  readonly deterministicFactsUsed: readonly string[];
  readonly interpretationsUsed: readonly string[];
  readonly assumptions: readonly string[];
  readonly uncertainties: readonly string[];
  readonly requiresHumanApproval: true;
  readonly oldContentHash: string;
  readonly proposedContentHash: string;
  readonly unifiedDiff?: string;
  readonly stale?: boolean;
}

export interface ManualDocumentationAction {
  readonly area: string;
  readonly reason: string;
  readonly impact: string;
}

export interface DocumentationDraftInput {
  readonly area: DocumentationArea;
  readonly target: DocforceAiAssistedTarget;
  readonly existingSectionContent?: string;
  readonly existingSectionHash?: string;
  readonly sectionExists: boolean;
  readonly assessment: AiChangeAssessment;
  readonly recommendationReason: string;
  readonly recommendationImpact: string;
  readonly relevantModelFacts: readonly string[];
  readonly changedFiles: readonly FileContext[];
  readonly truncationApplied: boolean;
}

export interface DocumentationDraftResult {
  readonly draft: WriterDraft;
  readonly metadata?: {
    readonly providerName: string;
    readonly modelId?: string;
    readonly requestId?: string;
    readonly latencyMs?: number;
  };
}

export interface DraftRunOptions {
  readonly baseRef: string;
  readonly headRef?: string;
  readonly repoRoot: string;
  readonly forceAiReview?: boolean;
}

export interface DocumentationProposalReport {
  readonly generatedAt: string;
  readonly docforceVersion: string;
  readonly baseRef: string;
  readonly headRef: string;
  readonly overallImpact: string;
  readonly manualReviewRecommended: boolean;
  readonly aiReviewTriggered: boolean;
  readonly aiReviewConfidence?: string;
  readonly aiReviewSummary?: string;
  readonly providerError?: string;
  readonly proposals: readonly AiDocumentationProposal[];
  readonly manualActions: readonly ManualDocumentationAction[];
  readonly conflicts: readonly { field: string; deterministicFact: string; aiClaim: string; resolution: string }[];
  readonly changedFiles: readonly string[];
  readonly changedComponents: readonly string[];
  readonly aiReviewConcerns: readonly string[];
  readonly aiBehavioralChange?: boolean;
  readonly applied: false;
}
