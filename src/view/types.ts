import type { ComponentPresentation, TechnologyPresentation } from "../config/types.js";
import type { ConfidenceLevel, Evidence } from "../model/types.js";

export const TECHNOLOGY_PRESENTATIONS = [
  "core-platform",
  "language-runtime",
  "framework",
  "datastore",
  "infrastructure",
  "external-integration",
  "capability-library",
  "supporting-library",
  "development-tool",
  "unknown-dependency",
] as const satisfies readonly TechnologyPresentation[];

export const COMPONENT_PRESENTATIONS = [
  "primary",
  "supporting",
  "utility",
  "neutral",
] as const;

export type ComponentViewPresentation = (typeof COMPONENT_PRESENTATIONS)[number];

export type CoverageStatus = "discovered" | "partially represented" | "unavailable";

export type ArchitectureViewKind =
  | "system-overview"
  | "software-architecture"
  | "deployment-architecture"
  | "data-architecture"
  | "device-architecture";

export type OverviewCategory =
  | "application-software"
  | "local-services"
  | "data-storage"
  | "external-integrations"
  | "device-peripherals"
  | "infrastructure-deployment";

export interface ViewEvidenceRef {
  readonly entityId: string;
  readonly evidence: readonly Evidence[];
}

export interface TechnologyViewItem {
  readonly name: string;
  readonly version?: string;
  readonly category: string;
  readonly purpose?: string;
  readonly presentation: TechnologyPresentation;
  readonly overridden: boolean;
  readonly evidence: readonly Evidence[];
  readonly confidence: ConfidenceLevel;
}

export interface ComponentViewItem {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly displayName: string;
  readonly type: string;
  readonly presentation: ComponentViewPresentation;
  readonly degree: number;
  readonly reasons: readonly string[];
  readonly evidence: readonly Evidence[];
  readonly summary?: string;
}

export interface ApiRouteGroup {
  readonly group: string;
  readonly routes: readonly ApiRouteViewItem[];
}

export interface ApiRouteViewItem {
  readonly path: string;
  readonly methods: readonly string[];
  readonly sourceFile: string;
  readonly relatedComponentId?: string;
  readonly evidence: readonly Evidence[];
}

export interface CoverageArea {
  readonly area: string;
  readonly status: CoverageStatus;
  readonly notes: string;
}

export interface ArchitectureViewSpec {
  readonly kind: ArchitectureViewKind;
  readonly available: boolean;
  readonly reason?: string;
  readonly nodeEntityIds: readonly string[];
  readonly relationshipIds: readonly string[];
}

export interface OverviewNode {
  readonly entityId: string;
  readonly label: string;
  readonly category: OverviewCategory;
}

export interface DocumentationViewModel {
  readonly technologies: readonly TechnologyViewItem[];
  readonly components: readonly ComponentViewItem[];
  readonly apiGroups: readonly ApiRouteGroup[];
  readonly apiRouteCount: number;
  readonly apiGroupCount: number;
  readonly overviewNodes: readonly OverviewNode[];
  readonly views: readonly ArchitectureViewSpec[];
  readonly coverage: readonly CoverageArea[];
}
