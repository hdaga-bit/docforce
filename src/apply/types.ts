import { z } from "zod";
import {
  DOCUMENTATION_AREAS,
  AI_CONFIDENCE_LEVELS,
  AiEvidenceReferenceSchema,
} from "../review/types.js";
import { PROPOSAL_OPERATIONS } from "../draft/types.js";
import type { AiEvidenceReference } from "../review/types.js";
import type { ProposalOperation } from "../draft/types.js";

export const PROPOSAL_APPLY_STATUSES = [
  "ready",
  "no-change",
  "already-applied",
  "stale",
  "revalidation-required",
  "invalid",
] as const;
export type ProposalApplyStatus = (typeof PROPOSAL_APPLY_STATUSES)[number];

/**
 * Canonical on-disk proposal. Integrity fields (fingerprint, hashes) are
 * checked at apply time. This is not a cryptographic signature.
 */
export const StoredProposalSchema = z.object({
  proposalId: z.string().min(1),
  createdAt: z.string().min(1),
  proposalFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  modelFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  baseRef: z.string().min(1),
  headRef: z.string().min(1),
  area: z.enum(DOCUMENTATION_AREAS),
  targetPath: z.string().min(1),
  sectionId: z.string().min(1),
  operation: z.enum(PROPOSAL_OPERATIONS),
  title: z.string().min(1),
  proposedContent: z.string(),
  summaryOfChange: z.string().min(1),
  confidence: z.enum(AI_CONFIDENCE_LEVELS),
  evidence: z.array(AiEvidenceReferenceSchema),
  deterministicFactsUsed: z.array(z.string()),
  interpretationsUsed: z.array(z.string()),
  assumptions: z.array(z.string()),
  uncertainties: z.array(z.string()),
  requiresHumanApproval: z.literal(true),
  oldContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  proposedContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  unifiedDiff: z.string().optional(),
});
export type StoredProposal = z.infer<typeof StoredProposalSchema>;

export interface ProposalApplicationPlan {
  readonly proposalId: string;
  readonly proposalFingerprint: string;
  readonly targetPath: string;
  readonly sectionId: string;
  readonly operation: ProposalOperation;
  readonly status: ProposalApplyStatus;
  readonly oldContentHash?: string;
  readonly currentContentHash?: string;
  readonly proposedContentHash?: string;
  readonly modelFingerprint?: string;
  readonly currentModelFingerprint?: string;
  readonly validationPassed: boolean;
  readonly staleReason?: string;
  readonly invalidReason?: string;
  readonly applied: boolean;
  readonly rolledBack: boolean;
  readonly sectionDiff?: string;
  readonly evidence: readonly AiEvidenceReference[];
  readonly preApplyErrors: readonly string[];
  readonly postApplyErrors: readonly string[];
  readonly appliedAt?: string;
}

export interface ApplyOptions {
  readonly repoRoot: string;
  readonly proposalId: string;
  /** When false (default), plan only — no file writes. */
  readonly apply: boolean;
  /** Test-only hooks. Must not be used by the CLI. */
  readonly testHooks?: ApplyTestHooks;
}

export interface ApplyTestHooks {
  afterWrite?: (absolutePath: string) => void;
  forceWriteError?: boolean;
}

export interface ProposalApplicationReport {
  readonly generatedAt: string;
  readonly docforceVersion: string;
  readonly plan: ProposalApplicationPlan;
}

export interface ApprovalRecord {
  readonly proposalId: string;
  readonly proposalFingerprint: string;
  readonly appliedAt: string;
  readonly target: string;
  readonly section: string;
  readonly beforeHash: string;
  readonly afterHash: string;
}
