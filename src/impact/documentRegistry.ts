import type { ModelDomain } from "./types.js";
import { ARTIFACT_REGISTRY } from "../update/artifactRegistry.js";

export interface DocumentDependency {
  readonly artifact: string;
  readonly dependsOn: readonly ModelDomain[];
}

/**
 * Central registry defining which model domains each generated artifact depends on.
 * Derived from ARTIFACT_REGISTRY so update, impact, and PR currency stay aligned.
 */
export const DOCUMENT_REGISTRY: readonly DocumentDependency[] = ARTIFACT_REGISTRY.map((artifact) => ({
  artifact: artifact.id,
  dependsOn: artifact.dependsOn,
}));

export function getRegisteredArtifacts(): readonly string[] {
  return DOCUMENT_REGISTRY.map((d) => d.artifact);
}

export function findAffectedArtifacts(
  changedDomains: ReadonlySet<ModelDomain>,
): DocumentDependency[] {
  return DOCUMENT_REGISTRY.filter((doc) =>
    doc.dependsOn.some((dep) => changedDomains.has(dep)),
  );
}
