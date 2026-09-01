export type {
  SystemModel,
  GenerationMetadata,
  GitInfo,
  ProductInfo,
  RuntimeInfo,
  LanguageInfo,
  TechnologyInfo,
  ComponentInfo,
  ComponentRole,
  DatastoreInfo,
  IntegrationInfo,
  InfrastructureInfo,
  WorkflowInfo,
  UnknownArea,
  Evidence,
  Provenance,
  ProvenancedFact,
  EvidenceKind,
  ConfidenceLevel,
  Relationship,
  RelationshipType,
} from "./types.js";

export { RELATIONSHIP_TYPES } from "./types.js";

export { buildSystemModel, buildMetadata, buildProductInfo, getGitInfo } from "./builder.js";
export type { ScanResults } from "./builder.js";

export { EVIDENCE_TYPES, evidenceSupportsRelationship } from "./evidenceTypes.js";
export type { EvidenceType } from "./evidenceTypes.js";
