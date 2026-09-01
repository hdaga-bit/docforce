import type { AiReviewInput, AiChangeAssessment, AiProviderMetadata } from "./types.js";

export interface ReasoningProviderResult {
  readonly assessment: AiChangeAssessment;
  readonly metadata?: AiProviderMetadata;
}

export interface ReasoningProvider {
  readonly name: string;
  analyzeChange(input: AiReviewInput, systemPrompt: string): Promise<ReasoningProviderResult>;
}

export class ProviderUnavailableError extends Error {
  constructor(provider: string, cause?: string) {
    super(`AI provider "${provider}" is unavailable${cause ? `: ${cause}` : ""}`);
    this.name = "ProviderUnavailableError";
  }
}
