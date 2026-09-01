import type { SystemModel, Relationship } from "../model/types.js";

export type ChangeType = "added" | "removed" | "modified" | "renamed";

export type ImpactLevel = "none" | "low" | "medium" | "high" | "architectural";

export interface FileChange {
  readonly path: string;
  readonly changeType: ChangeType;
  readonly oldPath?: string;
}

export type ModelDomain =
  | "product"
  | "technologies"
  | "components"
  | "integrations"
  | "datastores"
  | "infrastructure"
  | "relationships"
  | "workflows"
  | "architecture-presentation"
  | "evidence"
  | "api-routes"
  | "devices";

export interface EntityChange {
  readonly domain: ModelDomain;
  readonly changeType: ChangeType;
  readonly name: string;
  readonly detail?: string;
}

export interface RelationshipChange {
  readonly changeType: ChangeType;
  readonly from: string;
  readonly to: string;
  readonly type: string;
  readonly detail?: string;
}

export interface ModelDelta {
  readonly entityChanges: readonly EntityChange[];
  readonly relationshipChanges: readonly RelationshipChange[];
  readonly changedDomains: ReadonlySet<ModelDomain>;
  readonly isEmpty: boolean;
}

export interface DocumentImpact {
  readonly artifact: string;
  readonly affected: boolean;
  readonly impactLevel: ImpactLevel;
  readonly reason: string;
  readonly triggeringDomains: readonly ModelDomain[];
}

export interface ChangeImpactReport {
  readonly baseRef: string;
  readonly headRef: string;
  readonly generatedAt: string;
  readonly docforceVersion: string;
  readonly fileChanges: readonly FileChange[];
  readonly modelDelta: ModelDelta;
  readonly overallImpactLevel: ImpactLevel;
  readonly manualReviewRecommended: boolean;
  readonly manualReviewReason?: string;
  readonly documentImpacts: readonly DocumentImpact[];
  readonly unknowns: readonly string[];
}

export interface ComparisonOptions {
  readonly baseRef: string;
  readonly headRef?: string;
  readonly repoRoot: string;
}
