export type EvidenceKind = "observation" | "inference" | "unknown";

export type ConfidenceLevel = "high" | "medium" | "low";

export interface Evidence {
  readonly sourceFile: string;
  readonly evidenceType: string;
  readonly line?: number;
  readonly detail?: string;
}

export interface Provenance {
  readonly kind: EvidenceKind;
  readonly confidence: ConfidenceLevel;
  readonly evidence: readonly Evidence[];
  readonly reasoning?: string;
}

export interface ProvenancedFact<T> {
  readonly value: T;
  readonly provenance: Provenance;
}

export interface ProductInfo {
  readonly name: string;
  readonly type: string;
  readonly description: string;
}

export interface RuntimeInfo {
  readonly name: string;
  readonly version?: string;
  readonly provenance: Provenance;
}

export interface LanguageInfo {
  readonly name: string;
  readonly version?: string;
  readonly provenance: Provenance;
}

export interface TechnologyInfo {
  readonly name: string;
  readonly version?: string;
  readonly category: string;
  readonly purpose?: string;
  readonly provenance: Provenance;
}

export type ComponentRole = string;

export interface ComponentInfo {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly displayName?: string;
  readonly description?: string;
  readonly type: string;
  readonly role?: ComponentRole;
  readonly entryPoints?: readonly string[];
  readonly provenance: Provenance;
}

export interface DatastoreInfo {
  readonly name: string;
  readonly type: string;
  readonly engine?: string;
  readonly location?: string;
  readonly provenance: Provenance;
}

export interface IntegrationInfo {
  readonly name: string;
  readonly type: string;
  readonly direction: "inbound" | "outbound" | "bidirectional";
  readonly protocol?: string;
  readonly provenance: Provenance;
}

export interface InfrastructureInfo {
  readonly type: string;
  readonly name: string;
  readonly detail?: string;
  readonly provenance: Provenance;
}

export interface WorkflowInfo {
  readonly name: string;
  readonly trigger?: string;
  readonly steps?: readonly string[];
  readonly provenance: Provenance;
}

export interface UnknownArea {
  readonly area: string;
  readonly description: string;
  readonly reason: string;
}

export interface ApiRouteInfo {
  readonly path: string;
  readonly sourceFile: string;
  readonly methods: readonly string[];
  readonly provenance: Provenance;
}

export type DeviceKind =
  | "device"
  | "device-service"
  | "sensor"
  | "peripheral"
  | "communication-interface";

export interface DeviceInfo {
  readonly id: string;
  readonly kind: DeviceKind;
  readonly name: string;
  readonly detail?: string;
  readonly provenance: Provenance;
}

export interface DiscoveryCoverage {
  readonly typescriptJavascriptRoots: number;
  readonly pythonRoots: number;
  readonly apiRoutes: number;
  readonly composeServices: number;
  readonly composeVolumes: number;
  readonly deviceEvidence: number;
  readonly unsupportedEvidence: readonly string[];
}

export interface GitInfo {
  readonly commitSha: string | null;
  readonly branch: string | null;
  readonly dirty: boolean | null;
}

export interface GenerationMetadata {
  readonly schemaVersion: string;
  readonly docforceVersion: string;
  readonly repositoryName: string;
  readonly repositoryRoot: string;
  readonly git: GitInfo;
  readonly generatedAt: string;
  readonly configHash: string;
}

// --- Relationship types (v0.2) ---

export const RELATIONSHIP_TYPES = [
  "imports",
  "depends-on",
  "invokes",
  "reads-from",
  "writes-to",
  "persists-to",
  "calls-api",
  "spawns",
  "publishes-to",
  "receives-from",
  "deploys",
  "configures",
  "runs-on",
  "attached-to",
  "communicates-over",
  "mounts",
] as const;

export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export interface Relationship {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly type: RelationshipType;
  readonly classification: EvidenceKind;
  readonly confidence: ConfidenceLevel;
  readonly evidence: readonly Evidence[];
  readonly derivedFrom?: readonly string[];
  readonly description?: string;
}

export interface SystemModel {
  readonly metadata: GenerationMetadata;
  readonly product: ProductInfo;
  readonly runtime: readonly RuntimeInfo[];
  readonly languages: readonly LanguageInfo[];
  readonly technologies: readonly TechnologyInfo[];
  readonly components: readonly ComponentInfo[];
  readonly datastores: readonly DatastoreInfo[];
  readonly integrations: readonly IntegrationInfo[];
  readonly infrastructure: readonly InfrastructureInfo[];
  readonly workflows: readonly WorkflowInfo[];
  readonly relationships: readonly Relationship[];
  readonly unknowns: readonly UnknownArea[];
  readonly apiRoutes: readonly ApiRouteInfo[];
  readonly devices: readonly DeviceInfo[];
  readonly coverage: DiscoveryCoverage;
}
