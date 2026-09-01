import type { ImpactLevel, ModelDomain } from "../impact/types.js";

export type ArtifactUpdateStatus =
  | "unaffected"
  | "unchanged"
  | "would-create"
  | "would-update";

export interface ArtifactUpdate {
  readonly artifact: string;
  readonly path: string;
  readonly status: ArtifactUpdateStatus;
  readonly impactLevel: ImpactLevel;
  readonly triggeringDomains: readonly ModelDomain[];
  readonly oldHash?: string;
  readonly newHash?: string;
  readonly reason: string;
}

export interface DocumentationUpdatePlan {
  readonly generatedAt: string;
  readonly docforceVersion: string;
  readonly baseRef: string;
  readonly headRef: string;
  readonly modelFingerprint: string;
  readonly overallImpact: ImpactLevel;
  readonly manualReviewRecommended: boolean;
  readonly manualReviewReason?: string;
  readonly artifacts: readonly ArtifactUpdate[];
  readonly validationPassed: boolean;
  readonly applied: boolean;
}

export interface UpdateOptions {
  readonly baseRef: string;
  readonly headRef?: string;
  readonly repoRoot: string;
  readonly apply: boolean;
}
