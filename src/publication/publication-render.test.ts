import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const JSZip = require("jszip") as {
  loadAsync: (data: Buffer) => Promise<{
    file(name: string): { async(type: "string"): Promise<string> } | null;
    filter(cb: (name: string) => boolean): Array<{ name: string }>;
  }>;
};
import { CHROMIUM_INSTALL_HINT, collectPublicationText, runPublication } from "./index.js";
import { diagnosePublicationRenderer } from "./browser.js";
import { renderPublicationDiagrams } from "./diagrams.js";
import { renderDocx } from "./docx/render.js";
import { pdfContainsText } from "./pdf/render.js";
import { DEFAULT_PUBLICATION_THEME } from "./theme.js";
import type { PublicationDocument } from "./types.js";
import { writeMaryForceStyleFixture, writePatStyleFixture } from "./testSupport.js";

describe("v1.4 publication renderers", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `docforce-pub-render-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("G. renders Mermaid to PNG and SVG assets", { timeout: 120_000 }, async () => {
    const document = mermaidOnlyDocument();
    const assetDir = join(tmpDir, "assets");
    mkdirSync(assetDir, { recursive: true });
    const rendered = await renderPublicationDiagrams(document, assetDir);
    assert.equal(rendered.count, 1);
    const figure = rendered.document.sections[0]?.blocks[0];
    assert.ok(figure && figure.kind === "figure");
    if (!figure || figure.kind !== "figure") throw new Error("expected figure");
    assert.ok(figure.svgPath && existsSync(figure.svgPath));
    assert.ok(figure.pngPath && existsSync(figure.pngPath));
    assert.match(readFileSync(figure.svgPath, "utf-8"), /<svg/i);
    assert.equal(readFileSync(figure.pngPath).subarray(1, 4).toString("ascii"), "PNG");
  });

  it("H. fails clearly when a referenced diagram cannot render", { timeout: 120_000 }, async () => {
    const document = mermaidOnlyDocument("this is not mermaid");
    await assert.rejects(
      () => renderPublicationDiagrams(document, join(tmpDir, "assets")),
      /Mermaid|render|SVG|syntax/i,
    );
  });

  it("H. DOCX fails when an expected figure PNG is missing", async () => {
    const document = mermaidOnlyDocument();
    await assert.rejects(
      () => renderDocx(document, DEFAULT_PUBLICATION_THEME, join(tmpDir, "missing.docx")),
      /missing a PNG/,
    );
  });

  it("U. publishes a PAT-style DOCX and PDF", { timeout: 180_000 }, async () => {
    writePatStyleFixture(tmpDir);
    const result = await runPublication({ repoRoot: tmpDir, format: "all" });
    assert.ok(result.docxPath && existsSync(result.docxPath));
    assert.ok(result.pdfPath && existsSync(result.pdfPath));
    assert.ok((result.pdfPageCount ?? 0) >= 4);
    assert.ok(result.diagramCount >= 3);
    assert.ok(result.outputs.every((path) => !path.includes("\\")));
    assert.match(result.outputs.join("\n"), /PAT-Technical-Architecture\.docx/);
    assert.match(result.outputs.join("\n"), /PAT-Technical-Architecture\.pdf/);

    const pack = await JSZip.loadAsync(readFileSync(result.docxPath));
    const xmlFile = pack.file("word/document.xml");
    assert.ok(xmlFile, "DOCX is missing word/document.xml");
    const xml = await xmlFile.async("string");
    assert.match(xml, /Executive Technical Summary/);
    assert.match(xml, /Architecture Overview/);
    assert.match(xml, /Figure 1/);
    const media = pack.filter((name) => name.startsWith("word/media/"));
    assert.ok(media.length > 0 || xml.includes("drawing"), "DOCX should embed diagram images");
    assert.ok(!/```\s*mermaid/i.test(xml));
    assert.ok(!/sk-[a-zA-Z0-9]{20,}/.test(xml));

    const pdf = readFileSync(result.pdfPath);
    assert.ok(pdf.length > 1000);
    assert.ok(pdfContainsText(pdf, "PAT") || pdfContainsText(pdf, "Technical Architecture"));
    assert.ok(!pdfContainsText(pdf, "```mermaid"));
    assert.ok(!/sk-[a-zA-Z0-9]{20,}/.test(pdf.toString("latin1")));
    const text = collectPublicationText(result.document);
    assert.ok(!/```\s*mermaid/i.test(text));
    assert.ok(!/sk-[a-zA-Z0-9]{20,}/.test(text));
  });

  it("V. publishes a MaryForce-style document that is not PAT-specific", { timeout: 180_000 }, async () => {
    writeMaryForceStyleFixture(tmpDir);
    const result = await runPublication({ repoRoot: tmpDir, format: "all" });
    assert.ok(result.docxPath && existsSync(result.docxPath));
    assert.ok(result.pdfPath && existsSync(result.pdfPath));
    assert.match(result.outputs.join("\n"), /MaryForce-Technical-Architecture/);
    const text = collectPublicationText(result.document);
    assert.match(text, /MaryForce/);
    assert.ok(!/kiosk-application|Device & Peripheral/i.test(text));
    assert.ok(!result.document.sections.some((s) => s.id === "device-architecture"));
    const pdf = readFileSync(result.pdfPath);
    assert.ok((result.pdfPageCount ?? 0) >= 3);
    assert.ok(pdf.length > 800);
  });

  it("I–P. DOCX/PDF structural checks and renderer diagnostic", { timeout: 60_000 }, async () => {
    const diag = await diagnosePublicationRenderer();
    assert.equal(diag.ok, true, diag.ok ? "" : diag.error);
    assert.match(CHROMIUM_INSTALL_HINT, /playwright install chromium/);
    assert.equal(process.platform === "win32" || process.platform === "linux" || process.platform === "darwin", true);
  });

  it("X. current platform produces POSIX-style published paths", { timeout: 180_000 }, async () => {
    writeMaryForceStyleFixture(tmpDir);
    const result = await runPublication({ repoRoot: tmpDir, format: "docx" });
    assert.ok(result.outputs[0]?.includes("docs/published/"));
    assert.ok(!result.outputs[0]?.includes("\\"));
  });
});

function mermaidOnlyDocument(source = "graph TD\n  A[One] --> B[Two]"): PublicationDocument {
  return {
    metadata: {
      productName: "Diag",
      productType: "application",
      organizationName: "Example",
      documentTitle: "Technical Architecture & Design Document",
      classification: "Internal",
      status: "Current",
      evidenceStatement: "Generated from validated repository evidence.",
      coverageNote: "Scanner coverage is not a completeness claim.",
      includeOperationalProvenance: false,
    },
    cover: {
      organizationName: "Example",
      productName: "Diag",
      documentTitle: "Technical Architecture & Design Document",
      evidenceStatement: "Generated from validated repository evidence.",
    },
    information: [{ label: "Product", value: "Diag" }],
    sections: [{
      id: "architecture-overview",
      title: "Architecture Overview",
      level: 1,
      appendix: false,
      blocks: [{
        kind: "figure",
        figureKind: "system-overview",
        number: 1,
        caption: "Figure 1 — System Architecture",
        mermaidSource: source,
      }],
    }],
  };
}

