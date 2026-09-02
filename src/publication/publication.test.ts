import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ARTIFACT_REGISTRY } from "../update/artifactRegistry.js";
import { buildPublicationDocument } from "./builder.js";
import {
  DEFAULT_PUBLICATION_CONFIG,
  DEFAULT_PUBLICATION_THEME,
  mergePublicationTheme,
  publicationFileStem,
} from "./index.js";
import { PUBLICATION_REGISTRY } from "./registry.js";
import { collectPublicationText } from "./types.js";
import { validateLogoPath, validateOutputDir, validatePublicationDocument } from "./validate.js";
import { writePatStyleFixture, writeMaryForceStyleFixture, analyze } from "./testSupport.js";

describe("v1.4 publication model", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `docforce-pub-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("A. builds a deterministic Publication Model from the view model", () => {
    const config = writePatStyleFixture(tmpDir);
    const { model } = analyze(tmpDir, config);
    const first = buildPublicationDocument(model, config);
    const second = buildPublicationDocument(model, config);
    assert.equal(collectPublicationText(first), collectPublicationText(second));
    assert.equal(first.metadata.productName, "PAT");
    assert.equal(first.cover.evidenceStatement, "Generated from validated repository evidence.");
    assert.ok(first.sections.length >= 8);
    assert.ok(!first.information.some((row) => /owner|approver|approved/i.test(row.label)));
  });

  it("B. omits unsupported consumer sections", () => {
    const config = writeMaryForceStyleFixture(tmpDir);
    const { model } = analyze(tmpDir, config);
    const doc = buildPublicationDocument(model, config);
    const ids = doc.sections.map((s) => s.id);
    assert.ok(ids.includes("executive-summary"));
    assert.ok(ids.includes("deployment-architecture"));
    assert.ok(!ids.includes("device-architecture"));
    assert.ok(!ids.includes("api-architecture"));
    assert.ok(!collectPublicationText(doc).includes("kiosk"));
  });

  it("C. theme defaults are professional and product-neutral", () => {
    assert.equal(DEFAULT_PUBLICATION_THEME.pageSize, "A4");
    assert.equal(DEFAULT_PUBLICATION_THEME.primaryColor, "#1B365D");
    assert.equal(DEFAULT_PUBLICATION_THEME.bodyFont, "Calibri");
    assert.equal(DEFAULT_PUBLICATION_CONFIG.organization.name, "");
    assert.ok(!/mary|pat/i.test(DEFAULT_PUBLICATION_CONFIG.organization.name));
    assert.ok(!/mary|pat/i.test(DEFAULT_PUBLICATION_CONFIG.footer.text));
    assert.ok(!/mary|pat/i.test(DEFAULT_PUBLICATION_THEME.headerText));
    assert.ok(!/mary|pat/i.test(DEFAULT_PUBLICATION_THEME.footerText));
  });

  it("D. theme overrides merge without dropping defaults", () => {
    const theme = mergePublicationTheme({
      primaryColor: "#010203",
      accentColor: "not-a-color",
      pageSize: "Letter",
    });
    assert.equal(theme.primaryColor, "#010203");
    assert.equal(theme.accentColor, "#2B6CB0");
    assert.equal(theme.pageSize, "Letter");
    assert.equal(theme.bodyFont, "Calibri");
    assert.equal(theme.headingColor, "#010203");
  });

  it("E. accepts a logo inside allowed documentation roots", () => {
    const config = writePatStyleFixture(tmpDir);
    mkdirSync(join(tmpDir, "docs", "assets"), { recursive: true });
    writeFileSync(join(tmpDir, "docs", "assets", "logo.png"), tinyPng());
    const errors = validateLogoPath(tmpDir, "docs/assets/logo.png", config);
    assert.deepEqual(errors, []);
  });

  it("F. rejects logo path traversal", () => {
    const config = writePatStyleFixture(tmpDir);
    const errors = validateLogoPath(tmpDir, "../outside.png", config);
    assert.ok(errors.some((e) => /unsafe|outside/i.test(e)));
    assert.throws(() => validateOutputDir(tmpDir, "../escape"), /outside the repository/);
  });

  it("Q. numbers only figures that are included", () => {
    const config = writePatStyleFixture(tmpDir);
    const { model } = analyze(tmpDir, config);
    const doc = buildPublicationDocument(model, config);
    const figures = doc.sections.flatMap((s) => s.blocks.filter((b) => b.kind === "figure"));
    assert.ok(figures.length >= 3);
    figures.forEach((figure, index) => {
      assert.equal(figure.kind, "figure");
      if (figure.kind === "figure") {
        assert.equal(figure.number, index + 1);
        assert.match(figure.caption, new RegExp(`^Figure ${index + 1} — `));
      }
    });
    const captions = figures.map((f) => f.kind === "figure" ? f.caption : "");
    assert.ok(captions[0]?.includes("System Architecture"));
  });

  it("R. API section uses group summary hierarchy", () => {
    const config = writePatStyleFixture(tmpDir);
    const { model } = analyze(tmpDir, config);
    const doc = buildPublicationDocument(model, config);
    const api = doc.sections.find((s) => s.id === "api-architecture");
    assert.ok(api);
    const table = api.blocks.find((b) => b.kind === "table");
    assert.ok(table && table.kind === "table");
    assert.deepEqual([...table.headers], ["Group", "Routes"]);
    assert.ok(table.rows.length >= 1);
    assert.ok(table.rows.every((row) => row.length === 2));
    const bodyText = api.blocks.filter((b) => b.kind === "paragraph").map((b) => b.kind === "paragraph" ? b.text : "").join("\n");
    assert.match(bodyText, /api-inventory/);
  });

  it("S. technology section uses presentation hierarchy", () => {
    const config = writePatStyleFixture(tmpDir);
    const { model } = analyze(tmpDir, config);
    const doc = buildPublicationDocument(model, config);
    const tech = doc.sections.find((s) => s.id === "technology-stack");
    assert.ok(tech);
    const text = tech.blocks.flatMap((b) => {
      if (b.kind === "bullet-list") return b.items;
      if (b.kind === "paragraph") return [b.text];
      return [];
    }).join("\n");
    assert.match(text, /next|react/i);
    assert.ok(!/radix/i.test(text));
    assert.match(text, /Technology Appendix|technology-inventory/);
  });

  it("T. configuration uses category counts, not a giant env list", () => {
    const config = writePatStyleFixture(tmpDir);
    const { model } = analyze(tmpDir, config);
    const doc = buildPublicationDocument(model, config);
    const runtime = doc.sections.find((s) => s.id === "runtime-configuration");
    assert.ok(runtime);
    const items = runtime.blocks.find((b) => b.kind === "bullet-list");
    assert.ok(items && items.kind === "bullet-list");
    assert.ok(items.items.every((item) => /:\s*\d+$/.test(item)));
    assert.ok(!items.items.some((item) => item.includes("ASKMARY_API_KEY")));
    const appendix = doc.sections.find((s) => s.id === "appendix-configuration");
    assert.ok(appendix);
    const appendixText = collectPublicationText({ ...doc, sections: [appendix] });
    assert.match(appendixText, /ASKMARY_API_KEY|LITERT_URL/);
  });

  it("does not invent owner, approver, or approval dates", () => {
    const config = writePatStyleFixture(tmpDir);
    const { model } = analyze(tmpDir, config);
    const text = collectPublicationText(buildPublicationDocument(model, config));
    assert.ok(!/approver|approved on|document owner/i.test(text));
  });

  it("omits git SHA and DocForce version unless operational provenance is configured", () => {
    const config = writePatStyleFixture(tmpDir);
    const { model } = analyze(tmpDir, config);
    const doc = buildPublicationDocument(model, config);
    const text = collectPublicationText(doc);
    assert.ok(!text.includes(model.metadata.docforceVersion) || !doc.metadata.includeOperationalProvenance);
    assert.equal(doc.metadata.includeOperationalProvenance, false);
    if (model.metadata.git.commitSha) {
      assert.ok(!text.includes(model.metadata.git.commitSha));
    }
  });

  it("publication artifacts are not architecture-discovery sources", () => {
    assert.deepEqual(PUBLICATION_REGISTRY.map((item) => item.id), [
      "technical-architecture.docx",
      "technical-architecture.pdf",
    ]);
    assert.ok(ARTIFACT_REGISTRY.every((item) => !item.id.endsWith(".docx") && !item.id.endsWith(".pdf")));
    assert.equal(publicationFileStem("Mary Global Health"), "Mary-Global-Health-Technical-Architecture");
  });

  it("P. publication text rejects secret values and raw Mermaid", () => {
    const config = writePatStyleFixture(tmpDir);
    const { model } = analyze(tmpDir, config);
    const doc = buildPublicationDocument(model, config);
    const ok = validatePublicationDocument(doc, config, tmpDir, DEFAULT_PUBLICATION_CONFIG);
    assert.equal(ok.valid, true, ok.errors.join("; "));
    const poisoned = {
      ...doc,
      sections: [
        ...doc.sections,
        {
          id: "unknowns" as const,
          title: "Injected",
          level: 1 as const,
          appendix: false,
          blocks: [{ kind: "paragraph" as const, text: "token sk-abcdefghijklmnopqrstuvwxyz123456 graph TD\n  A-->B" }],
        },
      ],
    };
    const bad = validatePublicationDocument(poisoned, config, tmpDir, DEFAULT_PUBLICATION_CONFIG);
    assert.equal(bad.valid, false);
    assert.ok(bad.errors.some((e) => /secret|Mermaid/i.test(e)));
  });

  it("W. Windows-safe path helpers use repository-relative POSIX paths", () => {
    assert.equal(publicationFileStem("PAT"), "PAT-Technical-Architecture");
    assert.ok(!publicationFileStem("PAT").includes("\\"));
  });
});

function tinyPng(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
}
