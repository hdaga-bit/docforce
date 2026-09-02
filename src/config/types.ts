import type { DocforcePublicationConfig } from "../publication/config.js";

export interface DocforceProductConfig {
  readonly name: string;
  readonly type: string;
  readonly description: string;
}

export interface DocforceScanningConfig {
  readonly rootDir: string;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
}

export interface DocforceAnalysisConfig {
  readonly exclude: readonly string[];
}

export type ComponentPresentation = "primary" | "supporting" | "utility";

export type TechnologyPresentation =
  | "core-platform"
  | "language-runtime"
  | "framework"
  | "datastore"
  | "infrastructure"
  | "external-integration"
  | "capability-library"
  | "supporting-library"
  | "development-tool"
  | "unknown-dependency";

export interface DocforceComponentOverride {
  readonly displayName?: string;
  readonly role?: string;
  readonly includeInOverview?: boolean;
  /** Presentation tier only. Does not change the System Model entity. */
  readonly presentation?: ComponentPresentation;
}

export interface DocforceArchitectureConfig {
  readonly components?: Readonly<Record<string, DocforceComponentOverride>>;
}

export interface DocforceDocsOutputConfig {
  readonly technicalOverview: string;
  readonly technologyInventory: string;
  readonly architectureDiagram: string;
  readonly dependencyGraph: string;
  readonly architectureEvidence: string;
  readonly systemOverview?: string;
  readonly softwareArchitecture?: string;
  readonly deploymentArchitecture?: string;
  readonly dataArchitecture?: string;
  readonly deviceArchitecture?: string;
  readonly apiInventory?: string;
  readonly configurationInventory?: string;
  readonly technicalArchitecture?: string;
}

export interface DocforceOutputConfig {
  readonly systemModel: string;
  readonly docs: DocforceDocsOutputConfig;
}

export const DEFAULT_DOCS_OUTPUT: Required<DocforceDocsOutputConfig> = {
  technicalOverview: "docs/generated/technical-overview.md",
  technologyInventory: "docs/generated/technology-inventory.md",
  architectureDiagram: "docs/generated/architecture.mmd",
  dependencyGraph: "docs/generated/dependency-graph.mmd",
  architectureEvidence: "docs/generated/architecture-evidence.md",
  systemOverview: "docs/generated/system-overview.mmd",
  softwareArchitecture: "docs/generated/software-architecture.mmd",
  deploymentArchitecture: "docs/generated/deployment-architecture.mmd",
  dataArchitecture: "docs/generated/data-architecture.mmd",
  deviceArchitecture: "docs/generated/device-architecture.mmd",
  apiInventory: "docs/generated/api-inventory.md",
  configurationInventory: "docs/generated/configuration-inventory.md",
  technicalArchitecture: "docs/generated/technical-architecture.md",
};

export function resolveDocsOutputPath(
  docs: DocforceDocsOutputConfig,
  key: keyof DocforceDocsOutputConfig,
): string {
  return docs[key] ?? DEFAULT_DOCS_OUTPUT[key];
}

export interface DocforceAiAssistedTarget {
  readonly area: string;
  readonly path: string;
  readonly sectionId: string;
  readonly sectionTitle?: string;
  readonly allowCreateSection: boolean;
  /** When true, apply may create the target file. Default false. */
  readonly allowCreateFile?: boolean;
}

export interface DocforceTechnologyOverride {
  readonly presentation: TechnologyPresentation;
}

export interface DocforceDocumentationConfig {
  readonly allowedRoots: readonly string[];
  readonly aiAssisted: readonly DocforceAiAssistedTarget[];
  /** Presentation-only technology class overrides. System Model entities stay unchanged. */
  readonly technologyOverrides?: Readonly<Record<string, DocforceTechnologyOverride>>;
  /** Presentation-only component tier overrides. */
  readonly componentOverrides?: Readonly<Record<string, { readonly presentation?: ComponentPresentation }>>;
}

export interface DocforceAiConfig {
  readonly provider?: string;
  readonly claude?: {
    readonly command?: string;
  };
}

/**
 * Outcome a policy rule maps to. Deliberately lower-case and provider-neutral;
 * `src/docforce/pr/status.ts` translates these into overall PR statuses.
 */
export const PR_STATUS_OUTCOMES = ["pass", "review", "action-required"] as const;
export type PrStatusOutcome = (typeof PR_STATUS_OUTCOMES)[number];

export interface DocforcePrStatusPolicy {
  /** Deterministic artifacts are stale or missing in the pull request. */
  readonly deterministicStale: PrStatusOutcome;
  /** A behavioural/manual documentation decision is outstanding. */
  readonly manualReview: PrStatusOutcome;
  /** AI review could not run while manual review was recommended. */
  readonly aiUnavailableWhenManualReviewRequired: PrStatusOutcome;
}

export interface DocforcePrConfig {
  readonly enabled: boolean;
  readonly requireDeterministicDocsCurrent: boolean;
  readonly behavioralReview: { readonly enabled: boolean };
  readonly aiReview: { readonly enabled: boolean };
  readonly statusPolicy: DocforcePrStatusPolicy;
}

export interface DocforceConfig {
  readonly schemaVersion: string;
  readonly product: DocforceProductConfig;
  readonly scanning: DocforceScanningConfig;
  readonly analysis: DocforceAnalysisConfig;
  readonly architecture: DocforceArchitectureConfig;
  readonly output: DocforceOutputConfig;
  readonly documentation: DocforceDocumentationConfig;
  readonly ai: DocforceAiConfig;
  readonly pr: DocforcePrConfig;
  /** Downstream publication styling. Not part of the System Model. */
  readonly publication?: DocforcePublicationConfig;
}
