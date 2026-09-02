import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { runAllScanners } from "../scanner/index.js";
import { buildSystemModel } from "../model/builder.js";
import { validateSystemModel } from "../validator/index.js";
import { generateAllDocs } from "../generator/index.js";
import { runPublication, publicationFileStem, CHROMIUM_INSTALL_HINT } from "../publication/index.js";
import { diagnosePublicationRenderer } from "../publication/browser.js";
import { inferRepository, trialConfig, TRIAL_DIR } from "./infer.js";
import { renderFeedbackTemplate } from "./feedback.js";
import { buildRepositorySummary, formatRepositorySummary, type RepositorySummary } from "./summary.js";
import { assertAllowedWritePath, collectConfiguredWritePaths, TRIAL_WRITE_ROOT } from "./paths.js";
import { runDoctor, type DoctorResult } from "./doctor.js";

export interface TryOptions {
  readonly repoRoot: string;
  readonly name?: string;
  readonly type?: string;
  readonly organization?: string;
  readonly diagnoseRenderer?: () => Promise<{ ok: boolean; error?: string }>;
}

export interface TryResult {
  readonly summary: RepositorySummary;
  readonly doctor: DoctorResult;
  readonly generated: readonly string[];
  readonly published: readonly string[];
  readonly publicationSkipped?: string;
  readonly feedbackPath: string;
  readonly wroteConfig: boolean;
}

export async function runTry(options: TryOptions): Promise<TryResult> {
  const repoRoot = resolve(options.repoRoot);
  const inferred = inferRepository(options);
  const config = trialConfig(inferred);
  for (const path of collectConfiguredWritePaths(config)) {
    assertAllowedWritePath(repoRoot, path, [TRIAL_WRITE_ROOT]);
  }

  const doctor = await runDoctor({
    repoRoot,
    requireConfig: false,
    diagnoseRenderer: options.diagnoseRenderer,
  });

  const scanResults = runAllScanners(repoRoot, config);
  const model = buildSystemModel(repoRoot, join(repoRoot, "docforce.yml"), config, scanResults);
  const validation = validateSystemModel(model);
  if (!validation.valid) {
    throw new Error(`Validation failed: ${validation.errors.map((e) => e.message).join("; ")}`);
  }

  const modelPath = join(repoRoot, config.output.systemModel);
  mkdirSync(dirname(modelPath), { recursive: true });
  writeFileSync(modelPath, JSON.stringify(model, null, 2), "utf-8");
  const generated = generateAllDocs(repoRoot, config, model).files.map((file) => file.path);

  let published: string[] = [];
  let publicationSkipped: string | undefined;
  const diagnose = options.diagnoseRenderer ?? diagnosePublicationRenderer;
  const renderer = await diagnose();
  if (!renderer.ok) {
    publicationSkipped =
      `Publication renderer unavailable.\n\nRun:\n\`${CHROMIUM_INSTALL_HINT.replace(/^DocForce publication requires Playwright Chromium. Install with: /, "")}\``;
  } else {
    try {
      const pub = await runPublication({
        repoRoot,
        format: "all",
        outputDir: TRIAL_DIR,
        config,
      });
      published = [...pub.outputs];
    } catch (err) {
      publicationSkipped = err instanceof Error ? err.message : String(err);
    }
  }

  const feedbackPath = `${TRIAL_DIR}/FEEDBACK.md`;
  writeFileSync(join(repoRoot, feedbackPath), renderFeedbackTemplate(model.product.name), "utf-8");

  return {
    summary: buildRepositorySummary(model, inferred.detected),
    doctor,
    generated,
    published,
    publicationSkipped,
    feedbackPath,
    wroteConfig: false,
  };
}

export function formatTryReport(result: TryResult): string {
  const stemHint = publicationFileStem(result.summary.product);
  const lines = [
    "DocForce Trial",
    "",
    formatRepositorySummary(result.summary),
    "",
    "Generated:",
  ];
  if (result.published.length > 0) {
    for (const path of result.published) lines.push(path);
  } else {
    lines.push(`${TRIAL_DIR}/${stemHint}.pdf  (not generated)`);
    lines.push(`${TRIAL_DIR}/${stemHint}.docx  (not generated)`);
  }
  if (result.publicationSkipped) {
    lines.push("");
    lines.push("Publication renderer unavailable.");
    lines.push("");
    lines.push("Run:");
    lines.push("`npx playwright install chromium`");
  }
  lines.push("");
  lines.push("No product source files were modified.");
  lines.push("");
  lines.push("To adopt DocForce:");
  lines.push("  docforce init");
  lines.push("  docforce run");
  return lines.filter((line, i, all) => !(line === "" && all[i - 1] === "")).join("\n");
}
