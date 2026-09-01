export type {
  ArtifactUpdateStatus,
  ArtifactUpdate,
  DocumentationUpdatePlan,
  UpdateOptions,
} from "./types.js";

export { ARTIFACT_REGISTRY, getArtifactDefinition } from "./artifactRegistry.js";
export type { ArtifactDefinition } from "./artifactRegistry.js";

export { stageArtifacts, buildArtifactUpdates } from "./staging.js";
export type { StagedArtifact } from "./staging.js";

export { validateStagedArtifacts } from "./validation.js";
export type { UpdateValidationResult } from "./validation.js";

export { applyArtifacts } from "./apply.js";
export type { ApplyResult } from "./apply.js";

export { generateUpdateReports } from "./reportGenerator.js";

import type { UpdateOptions, DocumentationUpdatePlan } from "./types.js";
import { analyzeChangeImpact } from "../impact/index.js";
import { scanWorkingTree } from "../impact/worktree.js";
import { loadConfig, resolveConfigPath } from "../config/index.js";
import { validateSystemModel } from "../validator/index.js";
import { stageArtifacts, buildArtifactUpdates } from "./staging.js";
import { validateStagedArtifacts } from "./validation.js";
import { applyArtifacts } from "./apply.js";
import { computeModelFingerprint } from "../model/fingerprint.js";
import { DOCFORCE_VERSION } from "../version.js";

export function runDocumentationUpdate(options: UpdateOptions): DocumentationUpdatePlan {
  const { baseRef, headRef, repoRoot, apply } = options;

  const impactReport = analyzeChangeImpact({ baseRef, headRef, repoRoot });

  const configPath = resolveConfigPath(repoRoot);
  const config = loadConfig(configPath);
  const model = scanWorkingTree(repoRoot);
  const fingerprint = computeModelFingerprint(model);

  const modelValidation = validateSystemModel(model);
  if (!modelValidation.valid) {
    return {
      generatedAt: new Date().toISOString(),
      docforceVersion: DOCFORCE_VERSION,
      baseRef: impactReport.baseRef,
      headRef: impactReport.headRef,
      modelFingerprint: fingerprint,
      overallImpact: impactReport.overallImpactLevel,
      manualReviewRecommended: impactReport.manualReviewRecommended,
      manualReviewReason: impactReport.manualReviewReason,
      artifacts: [],
      validationPassed: false,
      applied: false,
    };
  }

  const staged = stageArtifacts(repoRoot, config, model, impactReport);
  const artifactUpdates = buildArtifactUpdates(staged);

  const validation = validateStagedArtifacts(staged, repoRoot);
  if (!validation.valid) {
    return {
      generatedAt: new Date().toISOString(),
      docforceVersion: DOCFORCE_VERSION,
      baseRef: impactReport.baseRef,
      headRef: impactReport.headRef,
      modelFingerprint: fingerprint,
      overallImpact: impactReport.overallImpactLevel,
      manualReviewRecommended: impactReport.manualReviewRecommended,
      manualReviewReason: impactReport.manualReviewReason,
      artifacts: artifactUpdates,
      validationPassed: false,
      applied: false,
    };
  }

  let applied = false;
  if (apply) {
    const hasChanges = staged.some((s) => s.status === "would-update" || s.status === "would-create");
    if (hasChanges) {
      const result = applyArtifacts(staged, repoRoot);
      if (result.rolledBack) {
        return {
          generatedAt: new Date().toISOString(),
          docforceVersion: DOCFORCE_VERSION,
          baseRef: impactReport.baseRef,
          headRef: impactReport.headRef,
          modelFingerprint: fingerprint,
          overallImpact: impactReport.overallImpactLevel,
          manualReviewRecommended: impactReport.manualReviewRecommended,
          manualReviewReason: impactReport.manualReviewReason,
          artifacts: artifactUpdates,
          validationPassed: true,
          applied: false,
        };
      }
      applied = true;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    docforceVersion: DOCFORCE_VERSION,
    baseRef: impactReport.baseRef,
    headRef: impactReport.headRef,
    modelFingerprint: fingerprint,
    overallImpact: impactReport.overallImpactLevel,
    manualReviewRecommended: impactReport.manualReviewRecommended,
    manualReviewReason: impactReport.manualReviewReason,
    artifacts: artifactUpdates,
    validationPassed: true,
    applied,
  };
}
