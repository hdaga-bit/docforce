import { createHash } from "node:crypto";
import type { StoredProposal } from "./types.js";

/**
 * Canonical SHA-256 over the proposal payload that will be applied, plus
 * the baseline the human reviewed.
 *
 * This is an integrity check for accidental corruption between draft and
 * apply. It is NOT tamper-proof authentication: anyone who can write
 * `.docforce/proposals/` can recompute a matching fingerprint.
 */
export function computeProposalFingerprint(
  proposal: Omit<StoredProposal, "proposalId" | "proposalFingerprint" | "createdAt" | "unifiedDiff">,
): string {
  const canonical = {
    area: proposal.area,
    targetPath: proposal.targetPath.replace(/\\/g, "/"),
    sectionId: proposal.sectionId,
    operation: proposal.operation,
    proposedContent: proposal.proposedContent,
    oldContentHash: proposal.oldContentHash,
    proposedContentHash: proposal.proposedContentHash,
    modelFingerprint: proposal.modelFingerprint,
    baseRef: proposal.baseRef,
    headRef: proposal.headRef,
    evidence: proposal.evidence.map((e) => ({
      path: e.path.replace(/\\/g, "/"),
      startLine: e.startLine ?? null,
      endLine: e.endLine ?? null,
    })),
    requiresHumanApproval: true as const,
  };
  return createHash("sha256").update(JSON.stringify(canonical), "utf-8").digest("hex");
}

export function proposalIdFromFingerprint(fingerprint: string): string {
  return `prop-${fingerprint.slice(0, 16)}`;
}

export function finalizeStoredProposal(
  unsigned: Omit<StoredProposal, "proposalId" | "proposalFingerprint">,
): StoredProposal {
  const proposalFingerprint = computeProposalFingerprint(unsigned);
  return {
    ...unsigned,
    proposalId: proposalIdFromFingerprint(proposalFingerprint),
    proposalFingerprint,
  };
}
