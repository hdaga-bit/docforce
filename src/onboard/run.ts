import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadConfig, resolveConfigPath } from "../config/index.js";
import { runAllScanners } from "../scanner/index.js";
import { buildSystemModel } from "../model/builder.js";
import { validateSystemModel } from "../validator/index.js";
import { generateAllDocs } from "../generator/index.js";
import { runPublication, CHROMIUM_INSTALL_HINT } from "../publication/index.js";
import { diagnosePublicationRenderer } from "../publication/browser.js";
import { inferRepository } from "./infer.js";
import { runDoctor, formatDoctorReport, type DoctorResult } from "./doctor.js";
import { buildRepositorySummary, formatRepositorySummary, type RepositorySummary } from "./summary.js";
import { assertAllowedWritePath, collectConfiguredWritePaths, RUN_WRITE_ROOTS } from "./paths.js";

export interface RunPipelineOptions {
  readonly repoRoot: string;
  readonly noPublish?: boolean;
  readonly diagnoseRenderer?: () => Promise<{ ok: boolean; error?: string }>;
}

export interface RunPipelineResult {
  readonly doctor: DoctorResult;
  readonly summary: RepositorySummary;
  readonly generated: readonly string[];
  readonly published: readonly string[];
  readonly publicationSkipped?: string;
}

export async function runOnboarded(options: RunPipelineOptions): Promise<RunPipelineResult> {
  const repoRoot = resolve(options.repoRoot);
  const doctor = await runDoctor({
    repoRoot,
    requireConfig: true,
    diagnoseRenderer: options.diagnoseRenderer,
  });
  if (doctor.status === "ERROR") {
    throw new Error(`${formatDoctorReport(doctor)}\n\nFix ERROR checks before \`docforce run\`.`);
  }

  const configPath = resolveConfigPath(repoRoot);
  const config = loadConfig(configPath);
  for (const path of collectConfiguredWritePaths(config)) {
    assertAllowedWritePath(repoRoot, path, RUN_WRITE_ROOTS);
  }

  const scanResults = runAllScanners(repoRoot, config);
  const model = buildSystemModel(repoRoot, configPath, config, scanResults);
  const validation = validateSystemModel(model);
  if (!validation.valid) {
    throw new Error(`Validation failed: ${validation.errors.map((e) => e.message).join("; ")}`);
  }

  const modelPath = resolve(repoRoot, config.output.systemModel);
  mkdirSync(dirname(modelPath), { recursive: true });
  writeFileSync(modelPath, JSON.stringify(model, null, 2), "utf-8");

  const generated = generateAllDocs(repoRoot, config, model).files.map((file) => file.path);

  let published: string[] = [];
  let publicationSkipped: string | undefined;
  if (options.noPublish) {
    publicationSkipped = "Publication skipped (--no-publish).";
  } else {
    const diagnose = options.diagnoseRenderer ?? diagnosePublicationRenderer;
    const renderer = await diagnose();
    if (!renderer.ok) {
      publicationSkipped = `Publication renderer unavailable. ${CHROMIUM_INSTALL_HINT}`;
    } else {
      try {
        const pub = await runPublication({ repoRoot, format: "all", config });
        published = [...pub.outputs];
      } catch (err) {
        publicationSkipped = err instanceof Error ? err.message : String(err);
      }
    }
  }

  const inferred = inferRepository({ repoRoot });
  return {
    doctor,
    summary: buildRepositorySummary(model, inferred.detected),
    generated,
    published,
    publicationSkipped,
  };
}

export function formatRunReport(result: RunPipelineResult): string {
  const lines = [
    "DocForce run",
    "",
    formatDoctorReport(result.doctor),
    "",
    formatRepositorySummary(result.summary),
    "",
    "Generated:",
  ];
  for (const path of result.generated) lines.push(path);
  if (result.published.length > 0) {
    lines.push("");
    lines.push("Published:");
    for (const path of result.published) lines.push(path);
  }
  if (result.publicationSkipped) {
    lines.push("");
    lines.push(result.publicationSkipped);
  }
  return lines.join("\n");
}
