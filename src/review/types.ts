import { z } from "zod";

export const AI_CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;
export type AiConfidence = (typeof AI_CONFIDENCE_LEVELS)[number];

export const CHANGE_CONCERNS = [
  "behavior", "security", "authorization", "authentication",
  "data-handling", "privacy", "reliability", "error-handling",
  "operations", "api-contract", "user-workflow", "observability",
  "performance", "configuration", "other",
] as const;
export type ChangeConcern = (typeof CHANGE_CONCERNS)[number];

export const DOCUMENTATION_AREAS = [
  "technical-overview", "architecture", "technology-inventory",
  "security", "data-handling", "reliability", "operations",
  "api-contract", "user-workflow", "configuration", "unknown/manual",
] as const;
export type DocumentationArea = (typeof DOCUMENTATION_AREAS)[number];

export const DOC_IMPACT_LEVELS = ["none", "low", "medium", "high"] as const;
export type DocImpactLevel = (typeof DOC_IMPACT_LEVELS)[number];

export const AiEvidenceReferenceSchema = z.object({
  path: z.string(),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
});
export type AiEvidenceReference = z.infer<typeof AiEvidenceReferenceSchema>;

export const DocumentationRecommendationSchema = z.object({
  area: z.enum(DOCUMENTATION_AREAS),
  impact: z.enum(DOC_IMPACT_LEVELS),
  reason: z.string(),
  evidence: z.array(AiEvidenceReferenceSchema),
});
export type DocumentationRecommendation = z.infer<typeof DocumentationRecommendationSchema>;

export const AiChangeAssessmentSchema = z.object({
  behavioralChangeDetected: z.boolean(),
  summary: z.string(),
  concerns: z.array(z.enum(CHANGE_CONCERNS)),
  confidence: z.enum(AI_CONFIDENCE_LEVELS),
  documentationRecommendations: z.array(DocumentationRecommendationSchema),
  evidence: z.array(AiEvidenceReferenceSchema),
  uncertainties: z.array(z.string()),
  requiresHumanConfirmation: z.boolean(),
});
export type AiChangeAssessment = z.infer<typeof AiChangeAssessmentSchema>;

export interface FileContext {
  readonly path: string;
  readonly diff?: string;
  readonly content?: string;
  readonly truncated?: boolean;
  /** Line numbers present in the supplied diff/excerpt (1-based). */
  readonly availableLineNumbers?: readonly number[];
}

export interface AiReviewInput {
  readonly changedFiles: readonly FileContext[];
  readonly impactReport: {
    readonly overallImpactLevel: string;
    readonly manualReviewRecommended: boolean;
    readonly manualReviewReason?: string;
    readonly changedDomains: readonly string[];
  };
  readonly affectedComponents: readonly string[];
  readonly relevantModelFacts: readonly string[];
  readonly totalFilesAvailable: number;
  readonly truncationApplied: boolean;
}

export interface AiConflict {
  readonly field: string;
  readonly deterministicFact: string;
  readonly aiClaim: string;
  readonly resolution: string;
}

export interface AiReviewResult {
  readonly triggered: boolean;
  readonly triggerReason?: string;
  readonly assessment?: AiChangeAssessment;
  readonly conflicts: readonly AiConflict[];
  readonly validationPassed: boolean;
  readonly validationErrors: readonly string[];
  readonly evidenceDowngraded: boolean;
  readonly providerMetadata?: AiProviderMetadata;
  readonly error?: string;
}

export interface AiProviderMetadata {
  readonly providerName: string;
  readonly modelId?: string;
  readonly requestId?: string;
  readonly latencyMs?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export interface DeterministicReviewContext {
  readonly overallImpactLevel: string;
  readonly manualReviewRecommended: boolean;
  readonly manualReviewReason?: string;
  readonly changedDomains: readonly string[];
  readonly changedComponents: readonly string[];
  readonly changedFiles: readonly string[];
}

export interface ReviewOptions {
  readonly baseRef: string;
  readonly headRef?: string;
  readonly repoRoot: string;
  readonly forceAiReview?: boolean;
  readonly limits?: ContextLimits;
}

export interface ContextLimits {
  readonly maxFiles: number;
  readonly maxCharsPerFile: number;
  readonly maxTotalChars: number;
  readonly maxContextLines: number;
}

export const DEFAULT_CONTEXT_LIMITS: ContextLimits = {
  maxFiles: 20,
  maxCharsPerFile: 10_000,
  maxTotalChars: 50_000,
  maxContextLines: 50,
};

export interface AiReviewReport {
  readonly generatedAt: string;
  readonly docforceVersion: string;
  readonly baseRef: string;
  readonly headRef: string;
  readonly deterministic: DeterministicReviewContext;
  readonly result: AiReviewResult;
}
