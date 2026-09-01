import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveConfigPath } from "../config/index.js";
import type { DocforceConfig } from "../config/types.js";
import { scanWorkingTree } from "../impact/worktree.js";
import { analyzeChangeImpact } from "../impact/index.js";
import { runAiReview } from "../review/index.js";
import { collectContext } from "../review/contextCollector.js";
import type { ReasoningProvider } from "../review/provider.js";
import type { DocumentationArea } from "../review/types.js";
import { getAiAssistedTarget } from "./ownership.js";
import { findSection, hashContent, parseManagedSections } from "./sections.js";
import { validateWriterDraft } from "./validation.js";
import { unifiedDiff } from "./diff.js";
import { buildWriterSystemPrompt } from "./prompt.js";
import { writeProposalArtifacts } from "./storage.js";
import { computeModelFingerprint } from "../model/fingerprint.js";
import { finalizeStoredProposal } from "../apply/fingerprint.js";
import { persistStoredProposal } from "../apply/store.js";
import type { DocumentationWriterProvider } from "./writer.js";
import type {
  AiDocumentationProposal,
  DraftRunOptions,
  DocumentationDraftInput,
  DocumentationProposalReport,
  ManualDocumentationAction,
} from "./types.js";
import { DOCFORCE_VERSION } from "../version.js";

export async function runDocumentationDraft(
  options: DraftRunOptions,
  providers: {
    reviewer?: ReasoningProvider;
    writer?: DocumentationWriterProvider;
  } = {},
): Promise<DocumentationProposalReport> {
  const { baseRef, headRef, repoRoot, forceAiReview } = options;
  const config = loadConfig(resolveConfigPath(repoRoot));
  const review = await runAiReview(
    { baseRef, headRef, repoRoot, forceAiReview },
    providers.reviewer,
  );

  const headLabel = review.headRef;
  const base = review.baseRef;

  const empty = (extra: Partial<DocumentationProposalReport> = {}): DocumentationProposalReport => ({
    generatedAt: new Date().toISOString(),
    docforceVersion: DOCFORCE_VERSION,
    baseRef: base,
    headRef: headLabel,
    overallImpact: review.deterministic.overallImpactLevel,
    manualReviewRecommended: review.deterministic.manualReviewRecommended,
    aiReviewTriggered: review.result.triggered,
    aiReviewConfidence: review.result.assessment?.confidence,
    aiReviewSummary: review.result.assessment?.summary,
    proposals: [],
    manualActions: [],
    conflicts: [...review.result.conflicts],
    changedFiles: [...review.deterministic.changedFiles],
    changedComponents: [...review.deterministic.changedComponents],
    aiReviewConcerns: [...(review.result.assessment?.concerns ?? [])],
    aiBehavioralChange: review.result.assessment?.behavioralChangeDetected,
    applied: false,
    ...extra,
  });

  if (!review.result.triggered || review.result.error || !review.result.assessment) {
    const report = empty({
      providerError: review.result.error
        ?? (!review.result.triggered ? `AI review not triggered: ${review.result.triggerReason}` : "No AI assessment"),
    });
    if (!review.result.triggered && !review.result.error) {
      const noError = empty({ providerError: undefined });
      writeProposalArtifacts(noError, repoRoot);
      return noError;
    }
    writeProposalArtifacts(report, repoRoot);
    return report;
  }

  if (review.result.conflicts.length > 0) {
    const report = empty({
      providerError: "Unresolved deterministic-vs-AI conflict; proposal generation skipped",
    });
    writeProposalArtifacts(report, repoRoot);
    return report;
  }

  const assessment = review.result.assessment;
  const recs = assessment.documentationRecommendations.filter((r) => r.impact !== "none");

  if (recs.length === 0 || !assessment.behavioralChangeDetected) {
    const report = empty();
    writeProposalArtifacts(report, repoRoot);
    return report;
  }

  if (!providers.writer) {
    const report = empty({
      providerError: "No documentation writer provider configured. Deterministic analysis is unchanged.",
    });
    writeProposalArtifacts(report, repoRoot);
    return report;
  }

  const model = scanWorkingTree(repoRoot);
  const modelFingerprint = computeModelFingerprint(model);
  const impactReport = analyzeChangeImpact({ baseRef, headRef, repoRoot });
  const context = collectContext(repoRoot, impactReport, model);
  const manualActions: ManualDocumentationAction[] = [];
  const proposals: AiDocumentationProposal[] = [];
  const systemPrompt = buildWriterSystemPrompt();
  const createdAt = new Date().toISOString();

  for (const rec of recs) {
    const target = getAiAssistedTarget(config, rec.area);
    if (!target) {
      manualActions.push({
        area: rec.area,
        impact: rec.impact,
        reason: `Manual documentation action required — area "${rec.area}" is not a registered AI-assisted target. ${rec.reason}`,
      });
      continue;
    }

    if (rec.evidence.length === 0 && rec.impact !== "low") {
      manualActions.push({
        area: rec.area,
        impact: rec.impact,
        reason: "Manual review — recommendation has insufficient evidence for an automatic draft",
      });
      continue;
    }

    const input = buildDraftInput(repoRoot, config, rec.area as DocumentationArea, target, assessment, rec.reason, rec.impact, context);
    try {
      const written = await providers.writer.proposeDocumentation(input, systemPrompt);
      const validation = validateWriterDraft(written.draft, input, config, repoRoot, model);
      if (!validation.valid || !validation.draft) {
        manualActions.push({
          area: rec.area,
          impact: rec.impact,
          reason: `Proposal rejected: ${validation.errors.join("; ")}`,
        });
        continue;
      }

      const proposed = normalizeSectionContent(validation.draft.proposedContent);
      const old = input.existingSectionContent ?? "";
      const oldHash = hashContent(old);
      const newHash = hashContent(proposed);
      const operation = !input.sectionExists
        ? "create-section" as const
        : oldHash === newHash
          ? "no-change" as const
          : "update-section" as const;

      const stored = finalizeStoredProposal({
        createdAt,
        modelFingerprint,
        baseRef: base,
        headRef: headLabel,
        area: rec.area as DocumentationArea,
        targetPath: target.path,
        sectionId: target.sectionId,
        operation,
        title: validation.draft.title,
        proposedContent: proposed,
        summaryOfChange: validation.draft.summaryOfChange,
        confidence: validation.draft.confidence,
        evidence: [...validation.draft.evidence],
        deterministicFactsUsed: [...input.relevantModelFacts],
        interpretationsUsed: [...validation.draft.interpretationsUsed],
        assumptions: [...validation.draft.assumptions],
        uncertainties: [...validation.draft.uncertainties],
        requiresHumanApproval: true,
        oldContentHash: oldHash,
        proposedContentHash: newHash,
      });
      persistStoredProposal(stored, repoRoot);

      proposals.push({
        ...stored,
        id: stored.proposalId,
        unifiedDiff: operation === "no-change" ? undefined : unifiedDiff(old, proposed, target.path),
        stale: false,
      });
    } catch (err) {
      const report = empty({
        providerError: `Writer failed: ${(err as Error).message}`,
        manualActions,
        proposals,
      });
      writeProposalArtifacts(report, repoRoot);
      return report;
    }
  }

  const report = empty({ proposals, manualActions, providerError: undefined });
  writeProposalArtifacts(report, repoRoot);
  return report;
}

function normalizeSectionContent(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
}

function buildDraftInput(
  repoRoot: string,
  _config: DocforceConfig,
  area: DocumentationArea,
  target: DocumentationDraftInput["target"],
  assessment: DocumentationDraftInput["assessment"],
  recommendationReason: string,
  recommendationImpact: string,
  context: ReturnType<typeof collectContext>,
): DocumentationDraftInput {
  const fullPath = join(repoRoot, target.path);
  let existingSectionContent: string | undefined;
  let sectionExists = false;

  if (existsSync(fullPath)) {
    const md = readFileSync(fullPath, "utf-8");
    const parsed = parseManagedSections(md);
    const section = parsed.valid ? findSection(md, target.sectionId) : undefined;
    if (section) {
      sectionExists = true;
      existingSectionContent = section.innerContent;
    }
  }

  return {
    area,
    target,
    existingSectionContent,
    existingSectionHash: existingSectionContent !== undefined ? hashContent(existingSectionContent) : hashContent(""),
    sectionExists,
    assessment,
    recommendationReason,
    recommendationImpact,
    relevantModelFacts: context.relevantModelFacts,
    changedFiles: context.changedFiles,
    truncationApplied: context.truncationApplied,
  };
}
