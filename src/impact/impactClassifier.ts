import type { ModelDelta, ImpactLevel, DocumentImpact, ModelDomain, FileChange } from "./types.js";
import { DOCUMENT_REGISTRY, findAffectedArtifacts } from "./documentRegistry.js";
import { classifyFileChanges, getProductRelevantChanges } from "./fileClassifier.js";

export interface ClassificationResult {
  readonly overallImpactLevel: ImpactLevel;
  readonly documentImpacts: readonly DocumentImpact[];
  readonly manualReviewRecommended: boolean;
  readonly manualReviewReason?: string;
}

export function classifyImpact(
  delta: ModelDelta,
  fileChanges: readonly FileChange[],
): ClassificationResult {
  const overallImpactLevel = computeOverallImpact(delta);
  const documentImpacts = computeDocumentImpacts(delta);
  const { manualReviewRecommended, manualReviewReason } = computeManualReview(delta, fileChanges);

  return {
    overallImpactLevel,
    documentImpacts,
    manualReviewRecommended,
    manualReviewReason,
  };
}

function computeOverallImpact(delta: ModelDelta): ImpactLevel {
  if (delta.isEmpty) return "none";

  const entities = delta.entityChanges;
  const rels = delta.relationshipChanges;

  const datastoreAdded = entities.some((e) => e.domain === "datastores" && e.changeType === "added");
  const datastoreRemoved = entities.some((e) => e.domain === "datastores" && e.changeType === "removed");
  if (datastoreAdded && datastoreRemoved) return "architectural";

  const integrationChanges = entities.filter((e) => e.domain === "integrations");
  if (integrationChanges.length >= 2 && (datastoreAdded || datastoreRemoved)) return "architectural";

  const hasHighImpactChange = entities.some((e) =>
    (e.domain === "components" || e.domain === "integrations" ||
     e.domain === "technologies" || e.domain === "infrastructure" ||
     e.domain === "datastores" || e.domain === "api-routes" || e.domain === "devices") &&
    (e.changeType === "added" || e.changeType === "removed"),
  );
  if (hasHighImpactChange) return "high";

  if (rels.length > 0) return "medium";
  const hasModification = entities.some((e) =>
    (e.domain === "components" || e.domain === "technologies" || e.domain === "integrations") &&
    e.changeType === "modified",
  );
  if (hasModification) return "medium";

  const onlyPresentationOrMetadata = entities.every((e) =>
    e.domain === "product" || e.domain === "architecture-presentation" || e.domain === "workflows",
  );
  if (onlyPresentationOrMetadata) return "low";

  return "low";
}

function computeDocumentImpacts(delta: ModelDelta): DocumentImpact[] {
  const changedDomains = delta.changedDomains;
  const affected = findAffectedArtifacts(changedDomains);
  const affectedNames = new Set(affected.map((a) => a.artifact));

  return DOCUMENT_REGISTRY.map((doc) => {
    const isAffected = affectedNames.has(doc.artifact);
    const triggeringDomains = doc.dependsOn.filter((dep) => changedDomains.has(dep));

    if (!isAffected) {
      return {
        artifact: doc.artifact,
        affected: false,
        impactLevel: "none" as const,
        reason: "No relevant model domains changed",
        triggeringDomains: [],
      };
    }

    let level: ImpactLevel = "low";
    for (const domain of triggeringDomains) {
      const domainChanges = delta.entityChanges.filter((e) => e.domain === domain);
      const hasAddRemove = domainChanges.some((e) => e.changeType === "added" || e.changeType === "removed");
      if (hasAddRemove && (domain === "components" || domain === "datastores" || domain === "integrations")) {
        level = "high";
        break;
      }
      if (domain === "relationships" && delta.relationshipChanges.length > 0) {
        level = "medium";
      }
      if (domainChanges.some((e) => e.changeType === "modified")) {
        level = level === "low" ? "medium" : level;
      }
    }

    return {
      artifact: doc.artifact,
      affected: true,
      impactLevel: level,
      reason: `Changed domains: ${triggeringDomains.join(", ")}`,
      triggeringDomains,
    };
  });
}

function computeManualReview(
  delta: ModelDelta,
  fileChanges: readonly FileChange[],
): { manualReviewRecommended: boolean; manualReviewReason?: string } {
  if (fileChanges.length === 0) {
    return { manualReviewRecommended: false };
  }

  const classified = classifyFileChanges(fileChanges);
  const productRelevant = getProductRelevantChanges(classified);

  if (productRelevant.length === 0) {
    return { manualReviewRecommended: false };
  }

  const sourceChanges = productRelevant.filter((f) => f.category === "source");

  if (sourceChanges.length > 0 && delta.isEmpty) {
    return {
      manualReviewRecommended: true,
      manualReviewReason: "Product source code changed but no deterministic architecture-model delta was detected. Application behaviour may have changed beyond current static-analysis capability.",
    };
  }

  return { manualReviewRecommended: false };
}
