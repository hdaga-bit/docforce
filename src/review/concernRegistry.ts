import type { DocumentationArea } from "./types.js";

export interface ConcernMapping {
  readonly area: DocumentationArea;
  readonly artifactId: string | null;
  readonly artifactPath?: string;
  readonly requiresHumanReview: boolean;
}

const AREA_TO_ARTIFACT: Record<DocumentationArea, string | null> = {
  "technical-overview": "technical-overview.md",
  "architecture": "architecture.mmd",
  "technology-inventory": "technology-inventory.md",
  "security": null,
  "data-handling": null,
  "reliability": null,
  "operations": null,
  "api-contract": null,
  "user-workflow": null,
  "configuration": null,
  "unknown/manual": null,
};

export function mapAreaToArtifact(area: DocumentationArea): ConcernMapping {
  const artifactId = AREA_TO_ARTIFACT[area];

  if (artifactId) {
    return {
      area,
      artifactId,
      artifactPath: artifactId,
      requiresHumanReview: false,
    };
  }

  return {
    area,
    artifactId: null,
    requiresHumanReview: true,
  };
}
