import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DocforceConfig } from "../config/types.js";
import { getAiAssistedTarget } from "../draft/ownership.js";
import { buildApplicationPlan } from "../apply/plan.js";
import { loadStoredProposal, proposalsDir } from "../apply/store.js";
import type { PrProposalAssessment } from "./types.js";

function approvalRecordPath(repoRoot: string, proposalId: string): string {
  return join(repoRoot, ".docforce", "approvals", `${proposalId}.json`);
}

function listStoredProposalIds(repoRoot: string): string[] {
  const dir = join(proposalsDir(repoRoot), "by-id");
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -".json".length))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Report the state of AI documentation proposals for this pull request.
 *
 * This is read-only: no proposal is generated, applied, or approved here. A
 * proposal is only reported as applied when an approval record exists on disk
 * or the target section already contains the proposed content.
 */
export function assessProposals(params: {
  readonly repoRoot: string;
  readonly config: DocforceConfig;
  readonly recommendedAreas: readonly string[];
}): PrProposalAssessment[] {
  const { repoRoot, config, recommendedAreas } = params;
  const assessments: PrProposalAssessment[] = [];
  const coveredTargets = new Set<string>();

  for (const proposalId of listStoredProposalIds(repoRoot)) {
    const loaded = loadStoredProposal(repoRoot, proposalId);
    if (!loaded.ok) {
      assessments.push({
        state: "proposal-stale",
        proposalId,
        detail: loaded.error,
        approvalRecordFound: false,
      });
      continue;
    }

    const proposal = loaded.proposal;
    coveredTargets.add(proposal.area);
    const approvalRecordFound = existsSync(approvalRecordPath(repoRoot, proposal.proposalId));

    let plan;
    try {
      plan = buildApplicationPlan(proposal, repoRoot).plan;
    } catch (err) {
      assessments.push({
        state: "proposal-stale",
        proposalId: proposal.proposalId,
        area: proposal.area,
        targetPath: proposal.targetPath,
        sectionId: proposal.sectionId,
        detail: `Proposal state could not be determined: ${(err as Error).message}`,
        approvalRecordFound,
      });
      continue;
    }

    const base = {
      proposalId: proposal.proposalId,
      area: proposal.area,
      targetPath: proposal.targetPath,
      sectionId: proposal.sectionId,
      approvalRecordFound,
    };

    switch (plan.status) {
      case "already-applied":
        assessments.push({
          ...base,
          state: "proposal-applied",
          detail: approvalRecordFound
            ? "Applied and recorded in the approval log"
            : "Target section already contains the proposed content",
        });
        break;
      case "ready":
        assessments.push({
          ...base,
          state: approvalRecordFound ? "proposal-applied" : "proposal-generated",
          detail: approvalRecordFound
            ? "Approval record found for this proposal"
            : "Proposal is pending explicit human application",
        });
        break;
      case "no-change":
        assessments.push({ ...base, state: "no-proposal-needed", detail: "Proposal is a no-change draft" });
        break;
      case "stale":
      case "revalidation-required":
      case "invalid":
        assessments.push({
          ...base,
          state: "proposal-stale",
          detail: plan.staleReason ?? plan.invalidReason ?? `Proposal status: ${plan.status}`,
        });
        break;
      default: {
        const exhaustive: never = plan.status;
        throw new Error(`Unhandled proposal status: ${String(exhaustive)}`);
      }
    }
  }

  for (const area of new Set(recommendedAreas)) {
    if (coveredTargets.has(area)) continue;
    const target = getAiAssistedTarget(config, area);
    if (target) {
      assessments.push({
        state: "proposal-recommended",
        area,
        targetPath: target.path,
        sectionId: target.sectionId,
        detail: "A registered AI-assisted target exists but no proposal has been generated",
        approvalRecordFound: false,
      });
    } else {
      assessments.push({
        state: "manual-target-required",
        area,
        detail: "No registered AI-assisted target for this documentation area",
        approvalRecordFound: false,
      });
    }
  }

  return assessments;
}
