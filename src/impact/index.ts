export type {
  ChangeType,
  ImpactLevel,
  FileChange,
  ModelDomain,
  EntityChange,
  RelationshipChange,
  ModelDelta,
  DocumentImpact,
  ChangeImpactReport,
  ComparisonOptions,
} from "./types.js";

export { getChangedFiles, resolveRef } from "./gitComparison.js";
export { scanAtRef, scanWorkingTree } from "./worktree.js";
export { compareModels } from "./modelDiff.js";
export { DOCUMENT_REGISTRY, getRegisteredArtifacts, findAffectedArtifacts } from "./documentRegistry.js";
export type { DocumentDependency } from "./documentRegistry.js";
export { classifyImpact } from "./impactClassifier.js";
export type { ClassificationResult } from "./impactClassifier.js";
export { generateReports } from "./reportGenerator.js";
export { validateImpactReport } from "./validation.js";
export type { ImpactValidationResult } from "./validation.js";
export { classifyFile, classifyFileChanges, getProductRelevantChanges } from "./fileClassifier.js";
export type { FileCategory, ClassifiedFileChange } from "./fileClassifier.js";

import type { ComparisonOptions, ChangeImpactReport } from "./types.js";
import { getChangedFiles, resolveRef } from "./gitComparison.js";
import { scanAtRef, scanWorkingTree } from "./worktree.js";
import { compareModels } from "./modelDiff.js";
import { classifyImpact } from "./impactClassifier.js";
import { DOCFORCE_VERSION } from "../version.js";

/**
 * Run full change impact analysis: compare Git refs, build models, diff, classify.
 */
export function analyzeChangeImpact(options: ComparisonOptions): ChangeImpactReport {
  const { baseRef, headRef, repoRoot } = options;

  const baseResolved = resolveRef(repoRoot, baseRef) ?? baseRef;
  const headLabel = headRef ? (resolveRef(repoRoot, headRef) ?? headRef) : "WORKTREE";

  const fileChanges = getChangedFiles(repoRoot, baseRef, headRef);

  const baseModel = scanAtRef(repoRoot, baseRef);
  const headModel = headRef ? scanAtRef(repoRoot, headRef) : scanWorkingTree(repoRoot);

  const modelDelta = compareModels(baseModel, headModel);

  const classification = classifyImpact(modelDelta, fileChanges);

  const unknowns: string[] = [];
  if (modelDelta.isEmpty && fileChanges.length > 0) {
    unknowns.push("File changes detected but no architecture-model delta was found. Behavioral changes may exist that static analysis cannot determine.");
  }

  return {
    baseRef: `${baseRef} (${baseResolved})`,
    headRef: headLabel,
    generatedAt: new Date().toISOString(),
    docforceVersion: DOCFORCE_VERSION,
    fileChanges,
    modelDelta,
    overallImpactLevel: classification.overallImpactLevel,
    manualReviewRecommended: classification.manualReviewRecommended,
    manualReviewReason: classification.manualReviewReason,
    documentImpacts: classification.documentImpacts,
    unknowns,
  };
}
