import type { DocumentationWriterProvider } from "./writer.js";
import type { DocumentationDraftInput, DocumentationDraftResult } from "./types.js";
import { WriterDraftSchema } from "./types.js";
import { ProviderUnavailableError } from "../review/provider.js";
import { buildWriterUserPrompt } from "./prompt.js";
import {
  invokeClaudePrint,
  parseClaudePrintJson,
  extractJsonCandidate,
  resolveClaudeExecutable,
} from "../ai/claudeInvoke.js";

export class ClaudeDocumentationWriter implements DocumentationWriterProvider {
  readonly name = "claude-cli";
  constructor(private readonly command?: string, private readonly timeoutMs?: number) {}

  async proposeDocumentation(
    input: DocumentationDraftInput,
    systemPrompt: string,
  ): Promise<DocumentationDraftResult> {
    const executable = resolveClaudeExecutable(this.command);
    if (!executable) {
      throw new ProviderUnavailableError(this.name, "Claude executable not available");
    }
    const user = buildWriterUserPrompt(input);
    const { stdout, latencyMs } = await invokeClaudePrint(`${systemPrompt}\n\n${user}`, {
      command: executable,
      timeoutMs: this.timeoutMs,
    });
    const parsed = parseClaudePrintJson(stdout);
    if (parsed.isError) {
      throw new ProviderUnavailableError(this.name, "Claude reported an error");
    }
    const json = extractJsonCandidate(parsed.resultText);
    const draft = WriterDraftSchema.safeParse(json);
    if (!draft.success) {
      throw new ProviderUnavailableError(this.name, "malformed or schema-invalid documentation draft");
    }
    return {
      draft: draft.data,
      metadata: {
        providerName: this.name,
        modelId: parsed.modelId,
        requestId: parsed.sessionId,
        latencyMs,
      },
    };
  }
}
