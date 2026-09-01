import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findSection, hashContent, parseManagedSections } from "../draft/sections.js";
import { loadStoredProposal } from "./store.js";
import { buildApplicationPlan } from "./plan.js";
import { atomicWriteFile, restoreFile } from "./write.js";
import { writeApplicationReports, writeApprovalRecord } from "./report.js";
import type { ApplyOptions, ProposalApplicationReport } from "./types.js";
import { DOCFORCE_VERSION } from "../version.js";

/**
 * Apply a previously stored, human-reviewed documentation proposal.
 *
 * This module must never invoke an AI provider. It operates only on the
 * stored proposal plus current repository state.
 */
export function applyProposal(options: ApplyOptions): ProposalApplicationReport {
  const { repoRoot, proposalId, apply } = options;
  const loaded = loadStoredProposal(repoRoot, proposalId);

  if (!loaded.ok) {
    const report: ProposalApplicationReport = {
      generatedAt: new Date().toISOString(),
      docforceVersion: DOCFORCE_VERSION,
      plan: {
        proposalId,
        proposalFingerprint: "",
        targetPath: "",
        sectionId: "",
        operation: "no-change",
        status: "invalid",
        validationPassed: false,
        invalidReason: loaded.error,
        applied: false,
        rolledBack: false,
        evidence: [],
        preApplyErrors: [loaded.error],
        postApplyErrors: [],
      },
    };
    writeApplicationReports(report, repoRoot);
    return report;
  }

  const { plan, originalFile, desiredFile } = buildApplicationPlan(loaded.proposal, repoRoot);

  const dry: ProposalApplicationReport = {
    generatedAt: new Date().toISOString(),
    docforceVersion: DOCFORCE_VERSION,
    plan,
  };

  if (!apply || !plan.validationPassed || plan.status !== "ready" || desiredFile === undefined) {
    writeApplicationReports(dry, repoRoot);
    return dry;
  }

  const absolutePath = join(repoRoot, plan.targetPath);
  const backup = originalFile ?? "";

  try {
    atomicWriteFile(absolutePath, desiredFile, options.testHooks);
    options.testHooks?.afterWrite?.(absolutePath);

    const post = postValidate(absolutePath, backup, loaded.proposal.sectionId, loaded.proposal.proposedContentHash, loaded.proposal.operation);
    if (!post.ok) {
      if (existsSync(absolutePath) && originalFile !== undefined) {
        restoreFile(absolutePath, backup);
      }
      const failed: ProposalApplicationReport = {
        generatedAt: new Date().toISOString(),
        docforceVersion: DOCFORCE_VERSION,
        plan: {
          ...plan,
          status: "invalid",
          validationPassed: false,
          applied: false,
          rolledBack: true,
          invalidReason: post.errors.join("; "),
          postApplyErrors: post.errors,
        },
      };
      writeApplicationReports(failed, repoRoot);
      return failed;
    }

    const appliedAt = new Date().toISOString();
    writeApprovalRecord({
      proposalId: plan.proposalId,
      proposalFingerprint: plan.proposalFingerprint,
      appliedAt,
      target: plan.targetPath,
      section: plan.sectionId,
      beforeHash: plan.oldContentHash ?? "",
      afterHash: plan.proposedContentHash ?? "",
    }, repoRoot);

    const success: ProposalApplicationReport = {
      generatedAt: appliedAt,
      docforceVersion: DOCFORCE_VERSION,
      plan: {
        ...plan,
        status: "ready",
        applied: true,
        rolledBack: false,
        appliedAt,
        postApplyErrors: [],
      },
    };
    writeApplicationReports(success, repoRoot);
    return success;
  } catch (err) {
    if (originalFile !== undefined && existsSync(absolutePath)) {
      try { restoreFile(absolutePath, backup); } catch { /* ignore */ }
    }
    const failed: ProposalApplicationReport = {
      generatedAt: new Date().toISOString(),
      docforceVersion: DOCFORCE_VERSION,
      plan: {
        ...plan,
        status: "invalid",
        validationPassed: false,
        applied: false,
        rolledBack: true,
        invalidReason: `Write failed: ${(err as Error).message}`,
        postApplyErrors: [(err as Error).message],
      },
    };
    writeApplicationReports(failed, repoRoot);
    return failed;
  }
}

function postValidate(
  absolutePath: string,
  originalFile: string,
  sectionId: string,
  proposedContentHash: string,
  operation: string,
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!existsSync(absolutePath)) {
    return { ok: false, errors: ["Target file missing after write"] };
  }
  const now = readFileSync(absolutePath, "utf-8");
  const parsed = parseManagedSections(now);
  if (!parsed.valid) {
    errors.push(`Post-write markers invalid: ${parsed.errors.join("; ")}`);
    return { ok: false, errors };
  }
  const matches = parsed.sections.filter((s) => s.id === sectionId);
  if (matches.length !== 1) {
    errors.push(`Section "${sectionId}" must exist exactly once after apply (found ${matches.length})`);
  }
  const section = matches[0];
  if (section && hashContent(section.innerContent) !== proposedContentHash) {
    errors.push("Post-write section hash does not match proposedContentHash");
  }

  if (operation === "update-section") {
    const beforeParsed = parseManagedSections(originalFile);
    const before = beforeParsed.sections.find((s) => s.id === sectionId);
    if (before && section) {
      const origBefore = originalFile.slice(0, before.innerStart);
      const origAfter = originalFile.slice(before.innerEnd);
      const nowBefore = now.slice(0, section.innerStart);
      const nowAfter = now.slice(section.innerEnd);
      if (origBefore !== nowBefore) {
        errors.push("Surrounding content before the managed section changed");
      }
      if (origAfter !== nowAfter) {
        errors.push("Surrounding content after the managed section changed");
      }
    }
  }

  if (operation === "create-section") {
    const origTrim = originalFile.replace(/\s*$/, "");
    if (origTrim.length > 0 && !now.startsWith(origTrim)) {
      errors.push("Create-section changed content before the appended block");
    }
  }

  return { ok: errors.length === 0, errors };
}
