#!/usr/bin/env node
import { resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig, resolveConfigPath } from "./config/index.js";
import { runAllScanners } from "./scanner/index.js";
import { buildSystemModel } from "./model/builder.js";
import { validateSystemModel } from "./validator/index.js";
import { generateAllDocs } from "./generator/index.js";
import { analyzeChangeImpact } from "./impact/index.js";
import { generateReports } from "./impact/reportGenerator.js";
import { validateImpactReport } from "./impact/validation.js";
import { runDocumentationUpdate } from "./update/index.js";
import { generateUpdateReports } from "./update/reportGenerator.js";
import { runAiReview } from "./review/index.js";
import { resolveReasoningProvider } from "./review/resolveProvider.js";
import { runDocumentationDraft } from "./draft/index.js";
import { FakeWriter } from "./draft/fakeWriter.js";
import { ClaudeDocumentationWriter } from "./draft/claudeWriter.js";
import { resolveClaudeExecutable } from "./ai/claudeInvoke.js";
import { applyProposal } from "./apply/index.js";
import { runPullRequestCheck } from "./pr/run.js";
import { resolveGithubPrContext } from "./pr/github/context.js";
import { resolvePullRequestReporter, type PrReporterKind } from "./pr/github/resolveReporter.js";
import { renderPrSummary } from "./pr/summary.js";
import { formatPackageIdentity } from "./version.js";
import {
  diagnosePublicationRenderer,
  formatPublicationReport,
  runPublication,
  type PublicationFormat,
} from "./publication/index.js";
import {
  formatDoctorReport,
  formatInitReport,
  formatRunReport,
  formatTryReport,
  runDoctor,
  runInit,
  runOnboarded,
  runTry,
} from "./onboard/index.js";

const COMMANDS = ["analyze", "generate", "run", "impact", "update", "review", "draft", "apply-proposal", "pr-check", "publish", "init", "doctor", "try"] as const;
type Command = (typeof COMMANDS)[number];

async function runPublish(args: string[]): Promise<void> {
  let repoRoot = resolve(".");
  let format: PublicationFormat = "all";
  let outputDir: string | undefined;
  let checkRenderer = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--repo" && args[i + 1]) {
      repoRoot = resolve(args[++i]!);
    } else if (arg === "--format" && args[i + 1]) {
      const value = args[++i]!;
      if (value !== "docx" && value !== "pdf" && value !== "all") {
        throw new Error(`Unknown --format "${value}". Use docx, pdf, or all.`);
      }
      format = value;
    } else if (arg === "--output-dir" && args[i + 1]) {
      outputDir = args[++i]!;
    } else if (arg === "--check-renderer") {
      checkRenderer = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: docforce publish [--format docx|pdf|all] [--output-dir <path>] [--repo <path>] [--check-renderer]");
      return;
    }
  }

  console.log(formatPackageIdentity());
  if (checkRenderer) {
    const diag = await diagnosePublicationRenderer();
    if (!diag.ok) {
      console.error(diag.error);
      process.exit(1);
    }
    console.log("Publication renderer: Playwright Chromium is available.");
    if (args.includes("--check-renderer") && !args.includes("--format") && outputDir === undefined) {
      return;
    }
  }

  const result = await runPublication({ repoRoot, format, outputDir, checkRenderer: false });
  console.log("");
  console.log(formatPublicationReport(result));
}

function parseOnboardArgs(args: string[]): {
  repoRoot: string;
  yes: boolean;
  force: boolean;
  noPublish: boolean;
  name?: string;
  type?: string;
  organization?: string;
} {
  let repoRoot = resolve(".");
  let yes = false;
  let force = false;
  let noPublish = false;
  let name: string | undefined;
  let type: string | undefined;
  let organization: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--repo" && args[i + 1]) repoRoot = resolve(args[++i]!);
    else if (arg === "--name" && args[i + 1]) name = args[++i]!;
    else if (arg === "--type" && args[i + 1]) type = args[++i]!;
    else if (arg === "--organization" && args[i + 1]) organization = args[++i]!;
    else if (arg === "--yes" || arg === "-y") yes = true;
    else if (arg === "--force") force = true;
    else if (arg === "--no-publish") noPublish = true;
    else if (!arg.startsWith("-") && args[0] === arg && i === 0) repoRoot = resolve(arg);
  }
  return { repoRoot, yes, force, noPublish, name, type, organization };
}

function runInitCli(args: string[]): void {
  const opts = parseOnboardArgs(args);
  console.log(formatPackageIdentity());
  const result = runInit({
    repoRoot: opts.repoRoot,
    yes: opts.yes,
    force: opts.force,
    name: opts.name,
    type: opts.type,
    organization: opts.organization,
  });
  console.log("");
  console.log(formatInitReport(result));
  if (!result.wrote) process.exit(1);
}

async function runDoctorCli(args: string[]): Promise<void> {
  const opts = parseOnboardArgs(args);
  console.log(formatPackageIdentity());
  console.log("");
  const result = await runDoctor({ repoRoot: opts.repoRoot, requireConfig: true });
  console.log(formatDoctorReport(result));
  if (result.status === "ERROR") process.exit(1);
}

async function runTryCli(args: string[]): Promise<void> {
  const opts = parseOnboardArgs(args);
  console.log(formatPackageIdentity());
  console.log("");
  const result = await runTry({
    repoRoot: opts.repoRoot,
    name: opts.name,
    type: opts.type,
    organization: opts.organization,
  });
  console.log(formatTryReport(result));
}

async function runRunCli(args: string[]): Promise<void> {
  const opts = parseOnboardArgs(args);
  console.log(formatPackageIdentity());
  console.log("");
  const result = await runOnboarded({
    repoRoot: opts.repoRoot,
    noPublish: opts.noPublish,
  });
  console.log(formatRunReport(result));
}

function main(): void {
  const args = process.argv.slice(2);
  const command = (args[0] as Command) || "run";

  if (!COMMANDS.includes(command)) {
    console.error(`Unknown command: ${args[0]}`);
    console.error(`Usage: docforce [${COMMANDS.join(" | ")}]`);
    process.exit(1);
  }

  if (command === "impact") {
    runImpact(args.slice(1));
    return;
  }

  if (command === "update") {
    runUpdate(args.slice(1));
    return;
  }

  if (command === "review") {
    runReview(args.slice(1));
    return;
  }

  if (command === "draft") {
    runDraft(args.slice(1));
    return;
  }

  if (command === "apply-proposal") {
    runApplyProposal(args.slice(1));
    return;
  }

  if (command === "pr-check") {
    runPrCheck(args.slice(1));
    return;
  }

  if (command === "publish") {
    void runPublish(args.slice(1)).catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
    return;
  }

  if (command === "init") {
    runInitCli(args.slice(1));
    return;
  }

  if (command === "doctor") {
    void runDoctorCli(args.slice(1)).catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
    return;
  }

  if (command === "try") {
    void runTryCli(args.slice(1)).catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
    return;
  }

  if (command === "run") {
    void runRunCli(args.slice(1)).catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
    return;
  }

  const repoRoot = resolve(args[1] ?? ".");
  const configPath = resolveConfigPath(repoRoot);

  console.log(formatPackageIdentity());
  console.log(`Repository: ${repoRoot}`);
  console.log(`Config: ${configPath}`);
  console.log("");

  const config = loadConfig(configPath);

  if (command === "analyze") {
    console.log("Scanning repository...");
    if (config.analysis.exclude.length > 0) {
      console.log(`  Analysis exclusions: ${config.analysis.exclude.join(", ")}`);
    }
    const scanResults = runAllScanners(repoRoot, config);
    console.log(`  Runtime: ${scanResults.runtime.length} found`);
    console.log(`  Languages: ${scanResults.languages.length} found`);
    console.log(`  Technologies: ${scanResults.technologies.length} found`);
    console.log(`  Components: ${scanResults.components.length} found`);
    console.log(`  Datastores: ${scanResults.datastores.length} found`);
    console.log(`  Integrations: ${scanResults.integrations.length} found`);
    console.log(`  Infrastructure: ${scanResults.infrastructure.length} found`);
    console.log(`  Workflows: ${scanResults.workflows.length} found`);
    console.log(`  Relationships: ${scanResults.relationships.length} found`);
    console.log(`  Unknown areas: ${scanResults.unknowns.length} identified`);
    const cov = scanResults.coverage;
    if (cov) {
      console.log("");
      console.log("Discovery Coverage");
      console.log(`  TypeScript/JavaScript roots: ${cov.typescriptJavascriptRoots}`);
      console.log(`  Python roots: ${cov.pythonRoots}`);
      console.log(`  API routes: ${cov.apiRoutes}`);
      console.log(`  Compose services: ${cov.composeServices}`);
      console.log(`  Compose volumes: ${cov.composeVolumes}`);
      console.log(`  Device evidence: ${cov.deviceEvidence}`);
      if (cov.unsupportedEvidence.length > 0) {
        console.log("  Unsupported evidence:");
        for (const item of cov.unsupportedEvidence) {
          console.log(`    - ${item}`);
        }
      }
    }
    console.log("");

    console.log("Building system model...");
    const model = buildSystemModel(repoRoot, configPath, config, scanResults);

    console.log("Validating system model...");
    const validation = validateSystemModel(model);

    if (!validation.valid) {
      console.error("Validation FAILED:");
      for (const err of validation.errors) {
        console.error(`  ERROR: ${err.path} — ${err.message}`);
      }
      process.exit(1);
    }

    if (validation.warnings.length > 0) {
      for (const warn of validation.warnings) {
        console.warn(`  WARNING: ${warn.path} — ${warn.message}`);
      }
    }

    console.log("Validation passed.");
    console.log("");

    const modelPath = resolve(repoRoot, config.output.systemModel);
    mkdirSync(dirname(modelPath), { recursive: true });
    writeFileSync(modelPath, JSON.stringify(model, null, 2), "utf-8");
    console.log(`System model: ${config.output.systemModel}`);

    console.log("");
    console.log("Analysis complete. Run 'docforce generate' to produce documentation.");
    return;
  }

  if (command === "generate") {
    console.log("Scanning repository...");
    const scanResults = runAllScanners(repoRoot, config);
    const model = buildSystemModel(repoRoot, configPath, config, scanResults);
    const validation = validateSystemModel(model);

    if (!validation.valid) {
      console.error("Validation FAILED — cannot generate documentation from invalid model.");
      for (const err of validation.errors) {
        console.error(`  ERROR: ${err.path} — ${err.message}`);
      }
      process.exit(1);
    }

    console.log("Generating documentation...");
    const result = generateAllDocs(repoRoot, config, model);
    for (const file of result.files) {
      console.log(`  ${file.path} (${file.bytes} bytes)`);
    }

    console.log("");
    console.log("Done.");
  }
}

function runImpact(args: string[]): void {
  let baseRef = "HEAD~1";
  let headRef: string | undefined;
  let repoRoot = resolve(".");
  let forceAiReview = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--base" && args[i + 1]) {
      baseRef = args[++i]!;
    } else if (args[i] === "--head" && args[i + 1]) {
      headRef = args[++i]!;
    } else if (args[i] === "--repo" && args[i + 1]) {
      repoRoot = resolve(args[++i]!);
    } else if (args[i] === "--ai-review") {
      forceAiReview = true;
    }
  }

  const headLabel = headRef ?? "WORKTREE";

  console.log(formatPackageIdentity());
  console.log("");
  console.log("Comparing:");
  console.log(`  ${baseRef} → ${headLabel}`);
  console.log("");

  try {
    const report = analyzeChangeImpact({ baseRef, headRef, repoRoot });

    const validation = validateImpactReport(report);
    if (!validation.valid) {
      console.error("Impact report validation warnings:");
      for (const err of validation.errors) {
        console.error(`  ERROR: ${err}`);
      }
    }

    console.log(`Files changed: ${report.fileChanges.length}`);
    console.log("");

    if (!report.modelDelta.isEmpty) {
      console.log("Model changes:");
      for (const ec of report.modelDelta.entityChanges) {
        const prefix = ec.changeType === "added" ? "+"
          : ec.changeType === "removed" ? "-"
          : "~";
        console.log(`  ${prefix} ${ec.domain}: ${ec.name}`);
      }
      for (const rc of report.modelDelta.relationshipChanges) {
        const prefix = rc.changeType === "added" ? "+" : "-";
        console.log(`  ${prefix} relationship: ${rc.from} → ${rc.to} (${rc.type})`);
      }
    } else {
      console.log("Model changes: 0");
    }
    console.log("");

    console.log(`Documentation impact: ${report.overallImpactLevel.toUpperCase()}`);
    if (report.manualReviewRecommended) {
      console.log(`Manual review: Yes`);
    }
    console.log("");

    const affected = report.documentImpacts.filter((d) => d.affected);
    if (affected.length > 0) {
      console.log("Affected artifacts:");
      for (const d of affected) {
        console.log(`  ✓ ${d.artifact}`);
      }
    } else {
      console.log("No documentation artifacts affected.");
    }
    console.log("");

    const { mdPath } = generateReports(report, repoRoot);
    console.log("Report:");
    console.log(`  ${mdPath.replace(repoRoot + "/", "")}`);

    if (forceAiReview) {
      console.log("");
      runReviewFromImpact({ baseRef, headRef, repoRoot, forceAiReview: true });
    }
  } catch (err) {
    console.error("Impact analysis failed:", (err as Error).message);
    process.exit(1);
  }
}

function runUpdate(args: string[]): void {
  let baseRef = "HEAD~1";
  let headRef: string | undefined;
  let repoRoot = resolve(".");
  let apply = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--base" && args[i + 1]) {
      baseRef = args[++i]!;
    } else if (args[i] === "--head" && args[i + 1]) {
      headRef = args[++i]!;
    } else if (args[i] === "--repo" && args[i + 1]) {
      repoRoot = resolve(args[++i]!);
    } else if (args[i] === "--apply") {
      apply = true;
    }
  }

  console.log(formatPackageIdentity());
  console.log("");

  if (!apply) {
    console.log("Mode: DRY RUN (pass --apply to write changes)");
  } else {
    console.log("Mode: APPLY");
  }
  console.log("");

  try {
    const plan = runDocumentationUpdate({ baseRef, headRef, repoRoot, apply });

    if (plan.overallImpact === "none") {
      console.log("Documentation impact: NONE");
      console.log("");
      console.log("No deterministic documentation updates required.");
      if (plan.manualReviewRecommended) {
        console.log("");
        console.log(`Manual review: Yes`);
        if (plan.manualReviewReason) {
          console.log(`  ${plan.manualReviewReason}`);
        }
      }
    } else {
      console.log(`Documentation impact: ${plan.overallImpact.toUpperCase()}`);
      if (plan.manualReviewRecommended) {
        console.log(`Manual review: Yes`);
      }
      console.log("");

      if (!plan.validationPassed) {
        console.error("Validation FAILED — no files will be modified.");
        process.exit(1);
      }

      console.log("Artifact updates:");
      for (const a of plan.artifacts) {
        const icon = a.status === "would-update" ? "✎"
          : a.status === "would-create" ? "+"
          : a.status === "unchanged" ? "="
          : "·";
        console.log(`  ${icon} ${a.artifact} — ${formatUpdateStatus(a.status)}`);
      }
      console.log("");

      if (plan.applied) {
        const writes = plan.artifacts.filter((a) => a.status === "would-update" || a.status === "would-create");
        console.log(`Applied: ${writes.length} file(s) updated.`);
      } else {
        const pending = plan.artifacts.filter((a) => a.status === "would-update" || a.status === "would-create");
        if (pending.length > 0) {
          console.log(`${pending.length} file(s) would be updated. Run with --apply to write changes.`);
        }
      }
    }

    console.log("");
    const { mdPath } = generateUpdateReports(plan, repoRoot);
    console.log("Report:");
    console.log(`  ${mdPath.replace(repoRoot + "/", "")}`);
  } catch (err) {
    console.error("Documentation update failed:", (err as Error).message);
    process.exit(1);
  }
}

function runReview(args: string[]): void {
  let baseRef = "HEAD~1";
  let headRef: string | undefined;
  let repoRoot = resolve(".");
  let forceAiReview = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--base" && args[i + 1]) {
      baseRef = args[++i]!;
    } else if (args[i] === "--head" && args[i + 1]) {
      headRef = args[++i]!;
    } else if (args[i] === "--repo" && args[i + 1]) {
      repoRoot = resolve(args[++i]!);
    } else if (args[i] === "--ai-review") {
      forceAiReview = true;
    }
  }

  console.log(formatPackageIdentity());
  console.log("");
  console.log("AI Change Review");
  console.log(`  Base: ${baseRef}`);
  console.log(`  Head: ${headRef ?? "WORKTREE"}`);
  if (forceAiReview) {
    console.log("  Mode: Forced AI review");
  }
  console.log("");

  runReviewFromImpact({ baseRef, headRef, repoRoot, forceAiReview });
}

function runReviewFromImpact(opts: {
  baseRef: string;
  headRef?: string;
  repoRoot: string;
  forceAiReview: boolean;
}): void {
  const provider = resolveReasoningProvider();
  if (provider) {
    console.log(`AI provider: ${provider.name}`);
  } else {
    console.log("AI provider: none (deterministic analysis only)");
  }
  console.log("");

  runAiReview({ ...opts }, provider)
    .then((report) => {
      const result = report.result;

      console.log(`Architecture impact: ${report.deterministic.overallImpactLevel.toUpperCase()}`);
      console.log(`Manual review: ${report.deterministic.manualReviewRecommended ? "Yes" : "No"}`);
      console.log("");

      if (!result.triggered) {
        console.log(`AI Review: NOT TRIGGERED`);
        console.log(`  Reason: ${result.triggerReason}`);
      } else if (result.error) {
        console.log(`AI Review: UNAVAILABLE`);
        console.log(`  ${result.error}`);
        console.log("  Deterministic analysis is unchanged.");
      } else if (result.assessment) {
        console.log(`AI Review: COMPLETED`);
        console.log(`  Behavioral change: ${result.assessment.behavioralChangeDetected ? "Yes" : "No"}`);
        console.log(`  Summary: ${result.assessment.summary}`);
        console.log(`  Confidence: ${result.assessment.confidence}`);
        if (result.assessment.concerns.length > 0) {
          console.log(`  Concerns: ${result.assessment.concerns.join(", ")}`);
        }
        if (result.assessment.requiresHumanConfirmation) {
          console.log("  Human confirmation: REQUIRED");
        }
        if (result.conflicts.length > 0) {
          console.log("");
          console.log("  Conflicts (AI vs deterministic — deterministic fact retained):");
          for (const c of result.conflicts) {
            console.log(`    - ${c.field}: AI claims "${c.aiClaim}" but deterministic says "${c.deterministicFact}"`);
          }
        }
        if (result.validationErrors.length > 0) {
          console.log("");
          console.log("  Validation notes:");
          for (const e of result.validationErrors) {
            console.log(`    - ${e}`);
          }
        }
      }

      console.log("");
      console.log("AI interpretations are not deterministic repository facts.");
      console.log("Reports: .docforce/reports/ai-change-review.md");
    })
    .catch((err) => {
      console.error("AI review failed (deterministic analysis is unchanged):", (err as Error).message);
    });
}

function resolveCliProviders(repoRoot: string): {
  reviewer: ReturnType<typeof resolveReasoningProvider>;
  writer: FakeWriter | ClaudeDocumentationWriter | undefined;
} {
  let claudeCmd: string | undefined;
  try {
    const config = loadConfig(resolveConfigPath(repoRoot));
    claudeCmd = config.ai.claude?.command;
  } catch {
    claudeCmd = undefined;
  }
  const requested = (process.env.DOCFORCE_AI_PROVIDER ?? "").trim().toLowerCase();
  const reviewer = resolveReasoningProvider(claudeCmd);
  if (requested === "fake") {
    return { reviewer, writer: new FakeWriter() };
  }
  const exe = resolveClaudeExecutable(claudeCmd);
  if (exe) {
    return { reviewer, writer: new ClaudeDocumentationWriter(exe) };
  }
  return { reviewer, writer: undefined };
}

function runDraft(args: string[]): void {
  let baseRef = "HEAD~1";
  let headRef: string | undefined;
  let repoRoot = resolve(".");
  let forceAiReview = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--base" && args[i + 1]) {
      baseRef = args[++i]!;
    } else if (args[i] === "--head" && args[i + 1]) {
      headRef = args[++i]!;
    } else if (args[i] === "--repo" && args[i + 1]) {
      repoRoot = resolve(args[++i]!);
    } else if (args[i] === "--ai-review") {
      forceAiReview = true;
    }
  }

  console.log(formatPackageIdentity());
  console.log("");
  console.log("AI Documentation Proposal");
  console.log(`  Base: ${baseRef}`);
  console.log(`  Head: ${headRef ?? "WORKTREE"}`);
  console.log("");

  const providers = resolveCliProviders(repoRoot);
  runDocumentationDraft({ baseRef, headRef, repoRoot, forceAiReview }, {
    reviewer: providers.reviewer,
    writer: providers.writer,
  }).then((report) => {
    console.log(`Deterministic impact: ${report.overallImpact.toUpperCase()}`);
    console.log(`Manual review: ${report.manualReviewRecommended ? "YES" : "NO"}`);
    console.log("");
    if (report.aiReviewTriggered && (report.aiReviewSummary || report.aiBehavioralChange !== undefined)) {
      console.log("AI review:");
      if (report.aiBehavioralChange) console.log("Behavioral change detected");
      else if (report.aiBehavioralChange === false) console.log("No behavioral change detected");
      if (report.aiReviewConcerns.length > 0) {
        console.log(`Concern: ${report.aiReviewConcerns.join(", ")}`);
      }
      if (report.aiReviewConfidence) console.log(`Confidence: ${report.aiReviewConfidence.toUpperCase()}`);
      if (report.aiReviewSummary) console.log(report.aiReviewSummary);
      console.log("");
    }
    if (report.providerError) {
      console.log(`Documentation proposal: UNAVAILABLE`);
      console.log(`  ${report.providerError}`);
    } else if (report.proposals.length === 0) {
      if (report.manualActions.length > 0) {
        console.log("Documentation proposal: MANUAL ACTION");
        for (const m of report.manualActions) {
          console.log(`  ${m.area}: ${m.reason}`);
        }
      } else {
        console.log("Documentation proposal: NONE");
      }
    } else {
      for (const p of report.proposals) {
        console.log("Documentation proposal:");
        console.log(`  Target: ${p.targetPath}`);
        console.log(`  Section: ${p.sectionId}`);
        console.log(`  Status: ${p.operation === "no-change" ? "NO-CHANGE" : "PROPOSED"}`);
        console.log(`  Confidence: ${p.confidence}`);
      }
    }
    console.log("");
    console.log("No documentation files were modified.");
    console.log("Proposal: .docforce/reports/documentation-proposal.md");
  }).catch((err) => {
    console.error("Draft failed (deterministic analysis is unchanged):", (err as Error).message);
  });
}

function runApplyProposal(args: string[]): void {
  let proposalId = "";
  let repoRoot = resolve(".");
  let apply = false;

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--proposal" || args[i] === "--id") && args[i + 1]) {
      proposalId = args[++i]!;
    } else if (args[i] === "--repo" && args[i + 1]) {
      repoRoot = resolve(args[++i]!);
    } else if (args[i] === "--apply") {
      apply = true;
    }
  }

  if (!proposalId) {
    console.error("Usage: docforce apply-proposal --proposal <proposal-id> [--apply]");
    process.exit(1);
  }

  console.log(formatPackageIdentity());
  console.log("");

  const report = applyProposal({ repoRoot, proposalId, apply });
  const p = report.plan;

  console.log("Proposal:");
  console.log(`  id: ${p.proposalId || proposalId}`);
  if (p.targetPath) console.log(`  target: ${p.targetPath}`);
  if (p.sectionId) console.log(`  section: ${p.sectionId}`);
  console.log("");

  const statusText = p.applied ? "APPLIED"
    : p.status === "revalidation-required" ? "REVALIDATION REQUIRED"
    : p.status === "already-applied" ? "NO CHANGE"
    : p.status === "no-change" ? "NO CHANGE"
    : p.status.toUpperCase();
  console.log(`Status: ${statusText}`);
  console.log("");

  if (p.operation) {
    console.log("Operation:");
    console.log(`  ${p.operation.replace("-", " ").toUpperCase()}`);
    console.log("");
  }

  if (p.currentContentHash) {
    console.log("Current section hash:");
    console.log(`  ${p.currentContentHash.slice(0, 16)}...`);
    console.log("");
  }
  if (p.proposedContentHash) {
    console.log("Proposed section hash:");
    console.log(`  ${p.proposedContentHash.slice(0, 16)}...`);
    console.log("");
  }

  if (p.staleReason) {
    console.log(p.staleReason);
    console.log("");
  }
  if (p.invalidReason) {
    console.log(p.invalidReason);
    console.log("");
  }

  if (p.applied) {
    console.log(`Updated:`);
    console.log(`${p.targetPath}`);
    console.log(`  section: ${p.sectionId}`);
    console.log("");
    console.log("Validation:");
    console.log(`${p.preApplyErrors.length === 0 ? "✓" : "✗"} proposal valid`);
    console.log(`${p.status !== "stale" ? "✓" : "✗"} target fresh`);
    console.log(`${p.modelFingerprint && p.currentModelFingerprint === p.modelFingerprint ? "✓" : "✗"} model fingerprint current`);
    console.log(`${p.postApplyErrors.length === 0 ? "✓" : "✗"} post-write section verified`);
    console.log("");
    console.log("No Git commit was created.");
    console.log("");
    console.log("Review with:");
    console.log("git diff");
  } else {
    console.log("No files modified.");
    if (p.status === "ready" && !apply) {
      console.log("");
      console.log("Run with --apply to apply this reviewed proposal.");
    }
  }

  console.log("");
  console.log("Report: .docforce/reports/proposal-application.md");
}

interface PrCheckArgs {
  baseRef?: string;
  headRef?: string;
  repoRoot: string;
  repository?: string;
  prNumber?: number;
  publish: boolean;
  reporterKind: PrReporterKind;
  forceAiReview: boolean;
  failOn: "never" | "review" | "action-required";
}

function parsePrCheckArgs(args: string[]): PrCheckArgs {
  const parsed: PrCheckArgs = {
    repoRoot: resolve("."),
    publish: true,
    reporterKind: "check",
    forceAiReview: false,
    failOn: "never",
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--base" && args[i + 1]) {
      parsed.baseRef = args[++i]!;
    } else if (arg === "--head" && args[i + 1]) {
      parsed.headRef = args[++i]!;
    } else if (arg === "--repo" && args[i + 1]) {
      parsed.repoRoot = resolve(args[++i]!);
    } else if (arg === "--repository" && args[i + 1]) {
      parsed.repository = args[++i]!;
    } else if (arg === "--pr" && args[i + 1]) {
      const value = Number(args[++i]);
      if (Number.isInteger(value) && value > 0) parsed.prNumber = value;
    } else if (arg === "--no-publish") {
      parsed.publish = false;
    } else if (arg === "--reporter" && args[i + 1]) {
      const value = args[++i]!;
      if (value === "check" || value === "comment" || value === "none") parsed.reporterKind = value;
    } else if (arg === "--ai-review") {
      parsed.forceAiReview = true;
    } else if (arg === "--fail-on" && args[i + 1]) {
      const value = args[++i]!;
      if (value === "never" || value === "review" || value === "action-required") parsed.failOn = value;
    }
  }

  return parsed;
}

function runPrCheck(args: string[]): void {
  const opts = parsePrCheckArgs(args);
  const context = resolveGithubPrContext(process.env);

  // Base precedence: explicit flag, then the PR event base SHA, then the base
  // branch that Actions reports, then the previous commit for local previews.
  const baseRef =
    opts.baseRef
    ?? context.baseSha
    ?? (context.baseRefName ? `origin/${context.baseRefName}` : undefined)
    ?? "HEAD~1";

  // In CI the checkout is the state being proposed, so assess it directly.
  const headRef = opts.headRef ?? (context.runningInActions ? "HEAD" : undefined);

  console.log(formatPackageIdentity());
  console.log("");
  console.log("Pull Request Documentation Check");
  console.log(`  Base: ${baseRef}`);
  console.log(`  Head: ${headRef ?? "WORKTREE"}`);
  if (context.repository ?? opts.repository) {
    console.log(`  Repository: ${opts.repository ?? context.repository}`);
  }
  if (context.prNumber ?? opts.prNumber) {
    console.log(`  Pull request: #${opts.prNumber ?? context.prNumber}`);
  }
  console.log("");

  const resolution = resolvePullRequestReporter({
    kind: opts.reporterKind,
    publish: opts.publish,
    context,
    repository: opts.repository,
    prNumber: opts.prNumber,
  });

  const providers = resolveCliProviders(opts.repoRoot);

  runPullRequestCheck({
    repoRoot: opts.repoRoot,
    baseRef,
    headRef,
    identity: {
      repository: opts.repository ?? context.repository,
      number: opts.prNumber ?? context.prNumber,
      baseRefName: context.baseRefName,
      headRefName: context.headRefName,
      fromFork: context.fromFork,
    },
    provider: providers.reviewer,
    forceAiReview: opts.forceAiReview,
    reporter: resolution.reporter,
    reporterName: resolution.name,
    skippedReason: resolution.skippedReason,
  })
    .then((result) => {
      console.log(renderPrSummary(result.assessment));

      if (result.localReport) {
        console.log(`Report: ${result.localReport.mdPath.replace(`${opts.repoRoot}/`, "")}`);
        console.log("");
      }

      if (resolution.skippedReason) {
        console.log(`Publishing skipped: ${resolution.skippedReason}`);
      } else if (result.reporting.published) {
        console.log(`Published via ${result.reporting.reporter}.`);
      } else if (result.reporting.error) {
        console.error(`Publishing failed via ${result.reporting.reporter}: ${result.reporting.error}`);
        console.error("The assessment above is unaffected.");
      }
      console.log("");
      console.log("No documentation, Git state, or pull request content was modified.");

      process.exit(prExitCode(result.assessment.status, opts.failOn));
    })
    .catch((err) => {
      console.error("PR check failed:", (err as Error).message);
      process.exit(1);
    });
}

function prExitCode(
  status: string,
  failOn: PrCheckArgs["failOn"],
): number {
  if (status === "ERROR") return 1;
  if (failOn === "action-required" && status === "ACTION_REQUIRED") return 1;
  if (failOn === "review" && (status === "ACTION_REQUIRED" || status === "REVIEW")) return 1;
  return 0;
}

function formatUpdateStatus(status: string): string {
  switch (status) {
    case "unaffected": return "UNAFFECTED";
    case "unchanged": return "UNCHANGED";
    case "would-create": return "WOULD CREATE";
    case "would-update": return "WOULD UPDATE";
    default: return status.toUpperCase();
  }
}

main();
