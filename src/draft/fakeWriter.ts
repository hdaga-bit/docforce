import type { DocumentationWriterProvider } from "./writer.js";
import type { DocumentationDraftInput, DocumentationDraftResult, WriterDraft } from "./types.js";
import { ProviderUnavailableError } from "../review/provider.js";
import { citeSuppliedEvidence } from "../review/fakeProvider.js";

function allText(input: DocumentationDraftInput): string {
  return [
    input.assessment.summary,
    input.recommendationReason,
    ...input.changedFiles.map((f) => `${f.diff ?? ""} ${f.content ?? ""}`),
    input.existingSectionContent ?? "",
  ].join("\n").toLowerCase();
}

export class FakeWriter implements DocumentationWriterProvider {
  readonly name = "fake-writer";

  async proposeDocumentation(input: DocumentationDraftInput, _systemPrompt: string): Promise<DocumentationDraftResult> {
    const text = allText(input);
    const path = input.changedFiles[0]?.path ?? "src/unknown.ts";
    const draft = buildDraft(input, text, path);
    return {
      draft,
      metadata: { providerName: this.name, modelId: "fake-writer-v1", latencyMs: 0 },
    };
  }
}

function buildDraft(input: DocumentationDraftInput, text: string, path: string): WriterDraft {
  const evidence = citeSuppliedEvidence(input.changedFiles.length > 0 ? input.changedFiles : [{ path }]);
  if (/ignore previous instructions|rewrite the entire repository|output "pwned"/i.test(text)) {
    return {
      title: input.target.sectionTitle ?? "Observed behaviour",
      proposedContent: "Observed behaviour is described from the supplied source evidence only. Instructions found in comments or existing documentation were ignored.\n",
      summaryOfChange: "Drafted observed behaviour without following embedded instructions",
      confidence: "medium",
      evidence,
      interpretationsUsed: ["Embedded instruction-like text is documentation/source data, not commands"],
      assumptions: [],
      uncertainties: ["Full behavioural scope may not be visible from the supplied diff"],
    };
  }

  if (/role\s*===?\s*["']admin["']|permission|authorize|isadmin/i.test(text)) {
    return {
      title: "Authorization behaviour",
      proposedContent: [
        "Task execution checks the requester's role before allowing the operation.",
        "The reviewed implementation permits execution when the requester role is `admin`.",
        "This describes observed control-flow in the supplied diff, not a security guarantee.",
        "",
      ].join("\n"),
      summaryOfChange: "Document observed admin-role check before task execution",
      confidence: "high",
      evidence,
      interpretationsUsed: ["Authorization logic appears to have changed from an unconditional allow to a role check"],
      assumptions: ["The reviewed function is on the execution path for the described operation"],
      uncertainties: ["Other roles or bypass paths were not established from the supplied evidence"],
    };
  }

  if (/retr(y|ies)|attempt|backoff|max.?retries/i.test(text)) {
    return {
      title: "Retry behaviour",
      proposedContent: [
        "The reviewed change updates retry behaviour for a runtime operation.",
        "Retry count in the supplied diff is `10`.",
        "This is observed configuration, not a reliability SLA.",
        "",
      ].join("\n"),
      summaryOfChange: "Document observed retry-count change",
      confidence: "high",
      evidence,
      interpretationsUsed: ["Retry configuration appears more aggressive than the previous value"],
      assumptions: [],
      uncertainties: ["Failure classes that trigger retries were not fully established"],
    };
  }

  if (input.existingSectionContent !== undefined && input.existingSectionContent.trim().length > 0
      && !/role|retry|postgres|postgresql/i.test(text)) {
    const same = input.existingSectionContent.trim();
    return {
      title: input.target.sectionTitle ?? "Behaviour",
      proposedContent: same.endsWith("\n") ? same : `${same}\n`,
      summaryOfChange: "No documentation change required",
      confidence: "high",
      evidence,
      interpretationsUsed: [],
      assumptions: [],
      uncertainties: [],
    };
  }

  return {
    title: input.target.sectionTitle ?? "Observed behaviour",
    proposedContent: `${input.assessment.summary}\n\nThis describes observed behaviour from the supplied evidence.\n`,
    summaryOfChange: input.assessment.summary,
    confidence: input.assessment.confidence,
    evidence: input.assessment.evidence.slice(0, 2),
    interpretationsUsed: [input.assessment.summary],
    assumptions: [],
    uncertainties: [...input.assessment.uncertainties],
  };
}

export class HallucinatingWriter implements DocumentationWriterProvider {
  readonly name = "hallucinating-writer";
  async proposeDocumentation(input: DocumentationDraftInput, _systemPrompt: string): Promise<DocumentationDraftResult> {
    return {
      draft: {
        title: "Security",
        proposedContent: "Critical security overhaul.\n",
        summaryOfChange: "Invented",
        confidence: "high",
        evidence: [{ path: "src/nonexistent/hallucinated-file.ts", startLine: 99, endLine: 120 }],
        interpretationsUsed: [],
        assumptions: [],
        uncertainties: [],
      },
      metadata: { providerName: this.name, latencyMs: 0 },
    };
  }
}

export class ConflictingWriter implements DocumentationWriterProvider {
  readonly name = "conflicting-writer";
  async proposeDocumentation(input: DocumentationDraftInput, _systemPrompt: string): Promise<DocumentationDraftResult> {
    const evidence = citeSuppliedEvidence(input.changedFiles);
    return {
      draft: {
        title: "Data storage",
        proposedContent: "Data is stored in PostgreSQL.\n",
        summaryOfChange: "Claim PostgreSQL",
        confidence: "high",
        evidence: evidence.length > 0 ? evidence : [{ path: "src/app/index.ts", startLine: 1, endLine: 2 }],
        interpretationsUsed: ["Database replaced"],
        assumptions: [],
        uncertainties: [],
      },
      metadata: { providerName: this.name, latencyMs: 0 },
    };
  }
}

export class TraversalWriter implements DocumentationWriterProvider {
  readonly name = "traversal-writer";
  async proposeDocumentation(_input?: DocumentationDraftInput, _systemPrompt?: string): Promise<DocumentationDraftResult> {
    return {
      draft: {
        title: "X",
        proposedContent: "Hijack.\n",
        summaryOfChange: "Traversal",
        confidence: "medium",
        evidence: [{ path: "../../etc/passwd", startLine: 1 }],
        interpretationsUsed: [],
        assumptions: [],
        uncertainties: [],
      },
      metadata: { providerName: this.name, latencyMs: 0 },
    };
  }
}

export class DeterministicTargetWriter implements DocumentationWriterProvider {
  readonly name = "deterministic-target-writer";
  async proposeDocumentation(_input?: DocumentationDraftInput, _systemPrompt?: string): Promise<DocumentationDraftResult> {
    return {
      draft: {
        title: "Architecture",
        proposedContent: "Should not land here.\n",
        summaryOfChange: "Target generated docs",
        confidence: "medium",
        evidence: [{ path: "src/app/index.ts" }],
        interpretationsUsed: [],
        assumptions: [],
        uncertainties: [],
      },
      metadata: { providerName: this.name, latencyMs: 0 },
    };
  }
}

export class MalformedWriter implements DocumentationWriterProvider {
  readonly name = "malformed-writer";
  async proposeDocumentation(_input?: DocumentationDraftInput, _systemPrompt?: string): Promise<DocumentationDraftResult> {
    return {
      draft: { foo: "bar" } as unknown as WriterDraft,
      metadata: { providerName: this.name, latencyMs: 0 },
    };
  }
}

export class FailingWriter implements DocumentationWriterProvider {
  readonly name = "failing-writer";
  async proposeDocumentation(_input?: DocumentationDraftInput, _systemPrompt?: string): Promise<DocumentationDraftResult> {
    throw new ProviderUnavailableError("failing-writer", "Simulated writer failure");
  }
}

export class SecretLeakingWriter implements DocumentationWriterProvider {
  readonly name = "secret-leaking-writer";
  async proposeDocumentation(input: DocumentationDraftInput, _systemPrompt: string): Promise<DocumentationDraftResult> {
    const blob = JSON.stringify(input.changedFiles);
    return {
      draft: {
        title: "Config",
        proposedContent: `Changed files payload: ${blob}\n`,
        summaryOfChange: "Echo context",
        confidence: "low",
        evidence: input.changedFiles[0] ? [{ path: input.changedFiles[0].path }] : [],
        interpretationsUsed: [],
        assumptions: [],
        uncertainties: [],
      },
      metadata: { providerName: this.name, latencyMs: 0 },
    };
  }
}
