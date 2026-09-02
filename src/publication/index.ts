import { mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig, resolveConfigPath } from "../config/index.js";
import type { DocforceConfig } from "../config/types.js";
import { runAllScanners } from "../scanner/index.js";
import { buildSystemModel } from "../model/builder.js";
import { validateSystemModel } from "../validator/index.js";
import { toFilesystemPath } from "../path/canonical.js";
import { removeTree } from "../path/fs.js";
import { DOCFORCE_VERSION } from "../version.js";
import { buildPublicationDocument } from "./builder.js";
import { PUBLICATION_STAGING_DIR, publicationFileStem, resolvePublicationConfig } from "./config.js";
import { renderPublicationDiagrams } from "./diagrams.js";
import { renderDocx } from "./docx/render.js";
import { renderPdf } from "./pdf/render.js";
import { closeSharedBrowser, diagnosePublicationRenderer } from "./browser.js";
import { validateOutputDir, validatePublicationDocument } from "./validate.js";
import type { PublicationDocument } from "./types.js";

export type PublicationFormat = "docx" | "pdf" | "all";

export interface PublicationOptions {
  readonly repoRoot: string;
  readonly format: PublicationFormat;
  readonly outputDir?: string;
  readonly checkRenderer?: boolean;
  readonly config?: DocforceConfig;
}

export interface PublicationResult {
  readonly format: PublicationFormat;
  readonly document: PublicationDocument;
  readonly diagramCount: number;
  readonly docxPath?: string;
  readonly pdfPath?: string;
  readonly pdfPageCount?: number;
  readonly elapsedMs: number;
  readonly outputs: readonly string[];
}

export async function runPublication(options: PublicationOptions): Promise<PublicationResult> {
  const started = Date.now();
  const repoRoot = resolve(options.repoRoot);
  if (options.checkRenderer) {
    const diag = await diagnosePublicationRenderer();
    if (!diag.ok) throw new Error(diag.error);
  }

  const configPath = resolveConfigPath(repoRoot);
  const config = options.config ?? loadConfig(configPath);
  const publication = resolvePublicationConfig(config.publication);
  const outputDirRel = options.outputDir ?? publication.outputDir;
  validateOutputDir(repoRoot, outputDirRel);
  const outputDir = resolve(repoRoot, outputDirRel);

  const scanResults = runAllScanners(repoRoot, config);
  const model = buildSystemModel(repoRoot, configPath, config, scanResults);
  const modelValidation = validateSystemModel(model);
  if (!modelValidation.valid) {
    throw new Error(`System model validation failed: ${modelValidation.errors.map((e) => e.message).join("; ")}`);
  }

  let document = buildPublicationDocument(model, config);
  if (document.cover.logoPath) {
    document = {
      ...document,
      cover: { ...document.cover, logoPath: toFilesystemPath(repoRoot, document.cover.logoPath) },
    };
  }

  const validation = validatePublicationDocument(document, config, repoRoot, publication);
  if (!validation.valid) {
    throw new Error(validation.errors.join("\n"));
  }

  const staging = join(repoRoot, PUBLICATION_STAGING_DIR);
  const assetDir = join(staging, "assets");
  if (existsSync(staging)) removeTree(staging);
  mkdirSync(assetDir, { recursive: true });

  const needBrowser = options.format !== "docx" || publicationFigures(document) > 0;
  let diagramCount = 0;
  try {
    if (needBrowser) {
      const rendered = await renderPublicationDiagrams(document, assetDir);
      document = rendered.document;
      diagramCount = rendered.count;
    }
    const post = validatePublicationDocument(document, config, repoRoot, publication);
    if (!post.valid) throw new Error(post.errors.join("\n"));

    mkdirSync(outputDir, { recursive: true });
    const stem = publicationFileStem(model.product.name);
    const outputs: string[] = [];
    let docxPath: string | undefined;
    let pdfPath: string | undefined;
    let pdfPageCount: number | undefined;

    if (options.format === "docx" || options.format === "all") {
      docxPath = join(outputDir, `${stem}.docx`);
      await renderDocx(document, publication.theme, docxPath);
      outputs.push(toRepoRel(repoRoot, docxPath));
    }
    if (options.format === "pdf" || options.format === "all") {
      pdfPath = join(outputDir, `${stem}.pdf`);
      const pdf = await renderPdf(document, publication.theme, pdfPath);
      pdfPageCount = pdf.pageCount;
      outputs.push(toRepoRel(repoRoot, pdfPath));
    }

    return {
      format: options.format,
      document,
      diagramCount,
      docxPath,
      pdfPath,
      pdfPageCount,
      elapsedMs: Date.now() - started,
      outputs,
    };
  } finally {
    await closeSharedBrowser();
    if (existsSync(staging)) {
      try { removeTree(staging); } catch { /* Windows file locks */ }
    }
  }
}

export function formatPublicationReport(result: PublicationResult): string {
  const lines = [
    `DocForce v${DOCFORCE_VERSION}`,
    "",
    "Publishing:",
    `${result.document.metadata.productName} — ${result.document.metadata.documentTitle}`,
    "",
    "✓ Publication Model built",
    `✓ ${result.diagramCount} diagram${result.diagramCount === 1 ? "" : "s"} rendered`,
  ];
  if (result.docxPath) lines.push("✓ DOCX generated");
  if (result.pdfPath) lines.push("✓ PDF generated");
  lines.push("✓ Publication validation passed");
  lines.push("");
  lines.push("Outputs:");
  for (const out of result.outputs) lines.push(out);
  return lines.join("\n");
}

function publicationFigures(doc: PublicationDocument): number {
  return doc.sections.reduce((n, s) => n + s.blocks.filter((b) => b.kind === "figure").length, 0);
}

function toRepoRel(repoRoot: string, abs: string): string {
  return abs.startsWith(repoRoot) ? abs.slice(repoRoot.length).replace(/^[\\/]/, "").replace(/\\/g, "/") : abs;
}

export { buildPublicationDocument } from "./builder.js";
export { diagnosePublicationRenderer, CHROMIUM_INSTALL_HINT } from "./browser.js";
export { collectPublicationText } from "./types.js";
export { PUBLICATION_REGISTRY } from "./registry.js";
export { DEFAULT_PUBLICATION_THEME } from "./theme.js";
export { DEFAULT_PUBLICATION_CONFIG, mergePublicationTheme, publicationFileStem } from "./config.js";
export { validateLogoPath, validatePublicationDocument } from "./validate.js";
export { countPdfPages, pdfContainsText } from "./pdf/render.js";
export type { PublicationDocument } from "./types.js";
export type { PublicationTheme } from "./theme.js";
export type { DocforcePublicationConfig } from "./config.js";
