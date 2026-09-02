export { loadConfig, resolveConfigPath } from "./config/index.js";
export type { DocforceConfig } from "./config/types.js";

export { buildSystemModel, applyComponentOverrides, EMPTY_COVERAGE } from "./model/builder.js";
export { getGitInfo } from "./model/builder.js";
export { computeModelFingerprint, shortFingerprint } from "./model/fingerprint.js";
export type { ScanResults } from "./model/builder.js";
export type {
  SystemModel,
  GitInfo,
  Evidence,
  Provenance,
  EvidenceKind,
  ConfidenceLevel,
  Relationship,
  RelationshipType,
} from "./model/types.js";
export { RELATIONSHIP_TYPES } from "./model/types.js";

export { EVIDENCE_TYPES, evidenceSupportsRelationship } from "./model/evidenceTypes.js";
export type { EvidenceType } from "./model/evidenceTypes.js";

export { runAllScanners } from "./scanner/index.js";
export { isExcluded } from "./scanner/exclusions.js";
export {
  buildInternalImportGraph,
  buildExternalIntegrationRelationships,
  buildDatastoreRelationships,
  detectLocalConstantIntegrations,
} from "./scanner/relationships.js";
export { normalizeExternalEntities } from "./scanner/normalize.js";
export { validateSystemModel } from "./validator/index.js";
export type { ValidationResult, ValidationOptions } from "./validator/index.js";
export { generateAllDocs } from "./generator/index.js";
export { generateTechnicalOverview } from "./generator/technicalOverview.js";
export { generateTechnologyInventory } from "./generator/technologyInventory.js";
export { generateArchitectureEvidence } from "./generator/architectureEvidence.js";
export { generateArchitectureOverview, generateDependencyGraph } from "./generator/architectureDiagram.js";
export {
  generateSystemOverview,
  generateSoftwareArchitecture,
  generateDeploymentArchitecture,
  generateDataArchitecture,
  generateDeviceArchitecture,
} from "./generator/architectureViews.js";
export { generateApiInventory } from "./generator/apiInventory.js";
export { generateTechnicalArchitecture } from "./generator/technicalArchitecture.js";
export {
  buildDocumentationViewModel,
  classifyTechnology,
  classifyComponent,
  groupApiRoutes,
} from "./view/index.js";
export type { DocumentationViewModel } from "./view/types.js";

// Impact analysis (v0.3)
export { analyzeChangeImpact } from "./impact/index.js";
export { compareModels } from "./impact/modelDiff.js";
export { DOCUMENT_REGISTRY, getRegisteredArtifacts, findAffectedArtifacts } from "./impact/documentRegistry.js";
export { classifyImpact } from "./impact/impactClassifier.js";
export { generateReports } from "./impact/reportGenerator.js";
export { validateImpactReport } from "./impact/validation.js";
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
} from "./impact/types.js";
export { classifyFile, classifyFileChanges, getProductRelevantChanges } from "./impact/fileClassifier.js";
export type { FileCategory, ClassifiedFileChange } from "./impact/fileClassifier.js";

// Deterministic documentation updates (v0.4)
export { runDocumentationUpdate } from "./update/index.js";
export { ARTIFACT_REGISTRY, getArtifactDefinition } from "./update/artifactRegistry.js";
export { stageArtifacts, buildArtifactUpdates } from "./update/staging.js";
export { validateStagedArtifacts } from "./update/validation.js";
export { applyArtifacts } from "./update/apply.js";
export { generateUpdateReports } from "./update/reportGenerator.js";
export type {
  ArtifactUpdateStatus,
  ArtifactUpdate,
  DocumentationUpdatePlan,
  UpdateOptions,
} from "./update/types.js";
export type { ArtifactDefinition } from "./update/artifactRegistry.js";
export type { StagedArtifact } from "./update/staging.js";
export type { UpdateValidationResult } from "./update/validation.js";
export type { ApplyResult } from "./update/apply.js";

// AI Change Review (v0.5)
export { runAiReview } from "./review/index.js";
export type { ReasoningProvider, ReasoningProviderResult } from "./review/provider.js";
export { FakeProvider, HallucinatingProvider, ConflictingProvider, FailingProvider, TimeoutProvider } from "./review/fakeProvider.js";
export { collectContext, redactSecrets, shouldCollectFile } from "./review/contextCollector.js";
export { buildSystemPrompt, buildUserPrompt, UNTRUSTED_EVIDENCE_START, UNTRUSTED_EVIDENCE_END } from "./review/prompt.js";
export { ClaudeCliProvider, isClaudeCliAvailable } from "./review/claudeCliProvider.js";
export { resolveReasoningProvider } from "./review/resolveProvider.js";
export { validateAiResponse } from "./review/responseValidator.js";
export { detectConflicts } from "./review/conflictDetector.js";
export { shouldTriggerAiReview, shouldSkipAiReview } from "./review/trigger.js";
export { mapAreaToArtifact } from "./review/concernRegistry.js";
export type {
  AiConfidence,
  ChangeConcern,
  DocumentationArea,
  DocImpactLevel,
  AiEvidenceReference,
  DocumentationRecommendation,
  AiChangeAssessment,
  FileContext,
  AiReviewInput,
  AiConflict,
  AiReviewResult,
  AiProviderMetadata,
  ReviewOptions,
  ContextLimits,
  AiReviewReport,
  DeterministicReviewContext,
} from "./review/types.js";

// AI documentation proposals (v0.6)
export { runDocumentationDraft } from "./draft/index.js";
export type { DocumentationWriterProvider } from "./draft/writer.js";
export { FakeWriter } from "./draft/fakeWriter.js";
export { parseManagedSections, hashContent, isProposalStale } from "./draft/sections.js";
export { validateWriterDraft, isProposalStaleAgainstFile } from "./draft/validation.js";

// Approved proposal application (v0.7)
export { applyProposal } from "./apply/index.js";
export { computeProposalFingerprint, finalizeStoredProposal } from "./apply/fingerprint.js";
export type { StoredProposal, ProposalApplicationPlan, ProposalApplyStatus } from "./apply/types.js";

// Pull request documentation assessment (v0.8)
export * from "./pr/index.js";
export {
  DOCFORCE_PACKAGE_NAME,
  DOCFORCE_VERSION,
  MODEL_SCHEMA_VERSION,
  getPackageIdentity,
  formatPackageIdentity,
} from "./version.js";
export type { DocforcePackageIdentity } from "./version.js";
export { DEFAULT_PR_CONFIG } from "./config/index.js";
export type { DocforcePrConfig, PrStatusOutcome } from "./config/types.js";
export {
  toModelPath,
  toFilesystemPath,
  isPathInsideRoot,
  isPathWithinAllowedRoots,
  toRepositoryRelativePath,
} from "./path/canonical.js";
export { canonicalizeNewlines, toGeneratedText, GENERATED_LINE_ENDING } from "./path/lineEnding.js";
export {
  resolveNpmCommand,
  resolveNpmCliEntry,
  resolveNodeCommand,
  resolveInstalledCliEntry,
} from "./runtime/exec.js";

// Professional publication (v1.4) — downstream of generated architecture
export {
  runPublication,
  formatPublicationReport,
  buildPublicationDocument,
  diagnosePublicationRenderer,
  collectPublicationText,
  PUBLICATION_REGISTRY,
  DEFAULT_PUBLICATION_THEME,
  DEFAULT_PUBLICATION_CONFIG,
  mergePublicationTheme,
  publicationFileStem,
  CHROMIUM_INSTALL_HINT,
} from "./publication/index.js";
export type {
  PublicationFormat,
  PublicationResult,
  PublicationOptions,
  PublicationDocument,
  PublicationTheme,
  DocforcePublicationConfig,
} from "./publication/index.js";
