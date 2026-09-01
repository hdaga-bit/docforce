import type { DocumentationDraftInput, DocumentationDraftResult } from "./types.js";

export interface DocumentationWriterProvider {
  readonly name: string;
  proposeDocumentation(
    input: DocumentationDraftInput,
    systemPrompt: string,
  ): Promise<DocumentationDraftResult>;
}
