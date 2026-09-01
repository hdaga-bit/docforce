import { existsSync, readFileSync } from "node:fs";
import { isUnsafeDeclaredPath, toFilesystemPath, toModelPath } from "../path/canonical.js";
import { loadConfig, resolveConfigPath } from "../config/index.js";
import type { DocforceConfig } from "../config/types.js";
import { scanWorkingTree } from "../impact/worktree.js";
import { computeModelFingerprint } from "../model/fingerprint.js";
import {
  classifyPathOwnership,
  findAiAssistedTarget,
  isDeterministicOwnedPath,
  isPathWithinAllowedRoots,
} from "../draft/ownership.js";
import { findSection, hashContent, parseManagedSections } from "../draft/sections.js";
import { unifiedDiff } from "../draft/diff.js";
import { computeProposalFingerprint } from "./fingerprint.js";
import { findSecretLikeContent } from "./secrets.js";
import { detectApplyConflicts } from "./conflicts.js";
import type { ProposalApplicationPlan, ProposalApplyStatus, StoredProposal } from "./types.js";

export interface PlannedApplication {
  readonly plan: ProposalApplicationPlan;
  readonly originalFile?: string;
  readonly desiredFile?: string;
}

export function buildApplicationPlan(
  proposal: StoredProposal,
  repoRoot: string,
): PlannedApplication {
  const errors: string[] = [];
  const config = loadConfig(resolveConfigPath(repoRoot));
  let modelFingerprint: string | undefined;
  try {
    const model = scanWorkingTree(repoRoot);
    modelFingerprint = computeModelFingerprint(model);
    errors.push(...detectApplyConflicts(proposal.proposedContent, model));
  } catch (err) {
    errors.push(`Unable to scan product model: ${(err as Error).message}`);
  }

  const expectedFp = computeProposalFingerprint(proposal);
  if (expectedFp !== proposal.proposalFingerprint) {
    errors.push(
      "Proposal fingerprint mismatch: stored proposal content does not match proposalFingerprint (corruption or modification). This check is integrity, not authentication.",
    );
  }

  if (hashContent(proposal.proposedContent) !== proposal.proposedContentHash) {
    errors.push("proposedContentHash does not match proposedContent");
  }

  if (proposal.proposedContent.includes("docforce:ai-section")
      || proposal.proposedContent.includes("/docforce:ai-section")) {
    errors.push("Proposed content must not include DocForce section markers");
  }

  const secret = findSecretLikeContent(proposal.proposedContent);
  if (secret) errors.push(secret);

  validateEvidence(proposal, errors);
  validateTarget(proposal, config, repoRoot, errors);

  const fullPath = toFilesystemPath(repoRoot, proposal.targetPath);
  const fileExists = existsSync(fullPath);
  const target = findAiAssistedTarget(config, proposal.targetPath, proposal.sectionId);
  const originalFile = fileExists ? readFileSync(fullPath, "utf-8") : undefined;

  let currentContentHash: string | undefined;
  let sectionDiff: string | undefined;
  let status: ProposalApplyStatus = errors.length > 0 ? "invalid" : "ready";
  let staleReason: string | undefined;
  let desiredFile: string | undefined;

  if (errors.length === 0 && proposal.operation === "no-change") {
    status = "no-change";
  }

  if (errors.length === 0 && proposal.operation === "create-section") {
    const created = planCreate(proposal, target, fileExists, originalFile, errors);
    if (created) {
      desiredFile = created.desiredFile;
      currentContentHash = created.currentContentHash;
      sectionDiff = created.sectionDiff;
      if (created.already) status = "already-applied";
    }
  }

  if (errors.length === 0 && proposal.operation === "update-section") {
    const updated = planUpdate(proposal, fileExists, originalFile, errors);
    if (updated) {
      desiredFile = updated.desiredFile;
      currentContentHash = updated.currentContentHash;
      sectionDiff = updated.sectionDiff;
      if (updated.already) status = "already-applied";
      if (updated.stale) {
        status = "stale";
        staleReason = updated.staleReason;
      }
    }
  }

  if (errors.length === 0 && status === "ready" && modelFingerprint
      && modelFingerprint !== proposal.modelFingerprint) {
    status = "revalidation-required";
    staleReason = "Deterministic product model fingerprint differs from the proposal baseline. Regenerate and review a fresh proposal.";
  }

  if (errors.length > 0) {
    status = "invalid";
    desiredFile = undefined;
  }

  if (status === "stale" || status === "revalidation-required" || status === "invalid") {
    desiredFile = undefined;
  }

  const validationPassed = errors.length === 0
    && status !== "invalid"
    && status !== "stale"
    && status !== "revalidation-required";

  const plan: ProposalApplicationPlan = {
    proposalId: proposal.proposalId,
    proposalFingerprint: proposal.proposalFingerprint,
    targetPath: proposal.targetPath,
    sectionId: proposal.sectionId,
    operation: proposal.operation,
    status,
    oldContentHash: proposal.oldContentHash,
    currentContentHash,
    proposedContentHash: proposal.proposedContentHash,
    modelFingerprint: proposal.modelFingerprint,
    currentModelFingerprint: modelFingerprint,
    validationPassed,
    staleReason,
    invalidReason: errors.length > 0 ? errors.join("; ") : undefined,
    applied: false,
    rolledBack: false,
    sectionDiff,
    evidence: proposal.evidence,
    preApplyErrors: errors,
    postApplyErrors: [],
  };

  return { plan, originalFile, desiredFile };
}

function validateEvidence(proposal: StoredProposal, errors: string[]): void {
  for (const e of proposal.evidence) {
    const path = toModelPath(e.path);
    if (isUnsafeDeclaredPath(path) || path.split("/").includes("..")) {
      errors.push(`Evidence path "${e.path}" is unsafe`);
    }
    if (e.startLine && e.endLine && e.startLine > e.endLine) {
      errors.push(`Evidence ${e.path} has invalid line range`);
    }
  }
}

function validateTarget(
  proposal: StoredProposal,
  config: DocforceConfig,
  repoRoot: string,
  errors: string[],
): void {
  const path = toModelPath(proposal.targetPath);
  if (isUnsafeDeclaredPath(path) || path.split("/").includes("..")) {
    errors.push(`Target path "${path}" is unsafe`);
  }
  if (!isPathWithinAllowedRoots(repoRoot, path, config.documentation.allowedRoots)) {
    errors.push(`Target path "${path}" is outside allowed documentation roots`);
  }
  if (isDeterministicOwnedPath(path, config) || classifyPathOwnership(path, config) === "deterministic") {
    errors.push(`Target path "${path}" is deterministic-owned and cannot receive AI proposal application`);
  }
  const target = findAiAssistedTarget(config, path, proposal.sectionId);
  if (!target) {
    errors.push(`Target ${path}#${proposal.sectionId} is not a registered AI-assisted section`);
    return;
  }
  if (target.area !== proposal.area) {
    errors.push(`Proposal area "${proposal.area}" does not match registered area "${target.area}"`);
  }
  if (classifyPathOwnership(path, config) !== "ai-assisted") {
    errors.push(`Target path "${path}" is not AI-assisted`);
  }
}

function planUpdate(
  proposal: StoredProposal,
  fileExists: boolean,
  originalFile: string | undefined,
  errors: string[],
): {
  desiredFile?: string;
  currentContentHash?: string;
  sectionDiff?: string;
  already: boolean;
  stale: boolean;
  staleReason?: string;
} | undefined {
  if (!fileExists || originalFile === undefined) {
    errors.push(`Target file "${proposal.targetPath}" does not exist`);
    return undefined;
  }
  const parsed = parseManagedSections(originalFile);
  if (!parsed.valid) {
    errors.push(`Target document has invalid managed-section markers: ${parsed.errors.join("; ")}`);
    return undefined;
  }
  const section = findSection(originalFile, proposal.sectionId);
  if (!section) {
    errors.push(`Managed section "${proposal.sectionId}" not found in ${proposal.targetPath}`);
    return undefined;
  }
  const currentContentHash = hashContent(section.innerContent);
  if (currentContentHash === proposal.proposedContentHash) {
    return {
      currentContentHash,
      already: true,
      stale: false,
      sectionDiff: undefined,
    };
  }
  if (currentContentHash !== proposal.oldContentHash) {
    return {
      currentContentHash,
      already: false,
      stale: true,
      staleReason: "Proposal rejected: target section changed since proposal generation.",
    };
  }

  const inner = proposal.proposedContent;
  const desiredFile = originalFile.slice(0, section.innerStart) + inner + originalFile.slice(section.innerEnd);
  const desiredParsed = parseManagedSections(desiredFile);
  if (!desiredParsed.valid) {
    errors.push(`Desired document would have invalid markers: ${desiredParsed.errors.join("; ")}`);
    return undefined;
  }
  return {
    desiredFile,
    currentContentHash,
    sectionDiff: unifiedDiff(section.innerContent, inner, proposal.targetPath),
    already: false,
    stale: false,
  };
}

function planCreate(
  proposal: StoredProposal,
  target: ReturnType<typeof findAiAssistedTarget>,
  fileExists: boolean,
  originalFile: string | undefined,
  errors: string[],
): {
  desiredFile?: string;
  currentContentHash?: string;
  sectionDiff?: string;
  already: boolean;
} | undefined {
  if (!target?.allowCreateSection) {
    errors.push(`Section "${proposal.sectionId}" creation is not permitted`);
    return undefined;
  }
  if (!fileExists || originalFile === undefined) {
    if (target.allowCreateFile === true) {
      errors.push("Creating a new documentation file is not implemented in v0.7 except via an existing registered document");
    } else {
      errors.push(`Target file "${proposal.targetPath}" does not exist and allowCreateFile is false`);
    }
    return undefined;
  }
  const parsed = parseManagedSections(originalFile);
  if (!parsed.valid) {
    errors.push(`Target document has invalid managed-section markers: ${parsed.errors.join("; ")}`);
    return undefined;
  }
  const existing = parsed.sections.find((s) => s.id === proposal.sectionId);
  if (existing) {
    const currentContentHash = hashContent(existing.innerContent);
    if (currentContentHash === proposal.proposedContentHash) {
      return { currentContentHash, already: true };
    }
    errors.push(`Section "${proposal.sectionId}" already exists; cannot apply create-section`);
    return undefined;
  }

  const inner = proposal.proposedContent;
  const block = `<!-- docforce:ai-section id="${proposal.sectionId}" -->${inner}<!-- /docforce:ai-section -->`;
  const base = originalFile.replace(/\s*$/, "");
  const desiredFile = `${base}\n\n${block}\n`;
  const desiredParsed = parseManagedSections(desiredFile);
  if (!desiredParsed.valid) {
    errors.push(`Desired document would have invalid markers: ${desiredParsed.errors.join("; ")}`);
    return undefined;
  }
  return {
    desiredFile,
    currentContentHash: hashContent(""),
    sectionDiff: unifiedDiff("", inner, proposal.targetPath),
    already: false,
  };
}
