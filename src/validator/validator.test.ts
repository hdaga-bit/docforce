import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateSystemModel } from "./index.js";
import type { SystemModel, Provenance, RuntimeInfo } from "../model/types.js";
import { EMPTY_COVERAGE } from "../model/builder.js";

function validProvenance(): Provenance {
  return {
    kind: "observation",
    confidence: "high",
    evidence: [{ sourceFile: "package.json", evidenceType: "dependency" }],
  };
}

function minimalValidModel(): SystemModel {
  return {
    metadata: {
      schemaVersion: "0.7.0",
      docforceVersion: "0.7.0",
      repositoryName: "test-repo",
      repositoryRoot: "/tmp/test-repo",
      git: { commitSha: "abc123", branch: "main", dirty: false },
      generatedAt: new Date().toISOString(),
      configHash: "deadbeef",
    },
    product: { name: "TestApp", type: "service", description: "Test" },
    runtime: [{
      name: "Node.js",
      provenance: validProvenance(),
    }],
    languages: [],
    technologies: [],
    components: [],
    datastores: [],
    integrations: [],
    infrastructure: [],
    workflows: [],
    relationships: [],
    unknowns: [],
    apiRoutes: [],
    devices: [],
    coverage: EMPTY_COVERAGE,
  };
}

describe("System Model Validator", () => {
  it("passes a valid minimal model", () => {
    const result = validateSystemModel(minimalValidModel());
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it("requires metadata.schemaVersion", () => {
    const model = minimalValidModel();
    (model.metadata as any).schemaVersion = "";
    const result = validateSystemModel(model);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.path === "metadata.schemaVersion"));
  });

  it("requires product.name", () => {
    const model = minimalValidModel();
    (model.product as any).name = "";
    const result = validateSystemModel(model);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.path === "product.name"));
  });

  it("requires provenance on all fact items", () => {
    const model = minimalValidModel();
    (model.runtime[0] as any).provenance = undefined;
    const result = validateSystemModel(model);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.message.includes("Provenance is required")));
  });

  it("requires evidence on observations", () => {
    const model = minimalValidModel();
    (model.runtime[0] as any).provenance = {
      kind: "observation",
      confidence: "high",
      evidence: [],
    };
    const result = validateSystemModel(model);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.message.includes("at least one evidence")));
  });

  it("requires sourceFile in evidence entries", () => {
    const model = minimalValidModel();
    (model.runtime[0] as any).provenance = {
      kind: "observation",
      confidence: "high",
      evidence: [{ sourceFile: "", evidenceType: "dep" }],
    };
    const result = validateSystemModel(model);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.message.includes("source file")));
  });

  it("warns on high-confidence inferences", () => {
    const model = minimalValidModel();
    (model.runtime[0] as any).provenance = {
      kind: "inference",
      confidence: "high",
      evidence: [{ sourceFile: "file.ts", evidenceType: "import" }],
    };
    const result = validateSystemModel(model);
    assert.ok(result.warnings.length > 0);
    assert.ok(result.warnings.some((w) => w.message.includes("Inferences should typically not have high confidence")));
  });

  it("rejects unknown-kind items that carry engineering rationale", () => {
    const model = minimalValidModel();
    (model.runtime as RuntimeInfo[]).push({
      name: "Mystery",
      provenance: {
        kind: "unknown",
        confidence: "low",
        evidence: [],
        reasoning: "I think they chose this because...",
      },
    });
    const result = validateSystemModel(model);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.message.includes("must not carry engineering rationale")));
  });

  it("validates unknown areas have required fields", () => {
    const model = minimalValidModel();
    (model.unknowns as any[]).push({ area: "", description: "Something", reason: "" });
    const result = validateSystemModel(model);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.path.includes("unknowns")));
  });

  it("unknown information stays unknown — not fabricated", () => {
    const model = minimalValidModel();
    const unknownItem: RuntimeInfo = {
      name: "Hypothetical Runtime",
      provenance: {
        kind: "unknown",
        confidence: "low",
        evidence: [],
      },
    };
    (model.runtime as RuntimeInfo[]).push(unknownItem);

    const result = validateSystemModel(model);
    assert.equal(result.valid, true);
    assert.equal(unknownItem.provenance.kind, "unknown");
    assert.equal(unknownItem.provenance.reasoning, undefined);
  });

  it("rejects integrations supported only by scanner source files", () => {
    const model = minimalValidModel();
    (model.integrations as any[]).push({
      name: "Slack (Bolt SDK)",
      type: "external-api",
      direction: "bidirectional",
      provenance: {
        kind: "observation",
        confidence: "high",
        evidence: [{
          sourceFile: "src/docforce/scanner/packageJson.ts",
          evidenceType: "source-analysis",
          detail: "Integration detected: Slack (Bolt SDK)",
        }],
      },
    });

    const result = validateSystemModel(model);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) =>
      e.message.includes("documentation tooling source"),
    ));
  });

  it("accepts integrations with evidence from application source", () => {
    const model = minimalValidModel();
    (model.integrations as any[]).push({
      name: "Slack (Bolt SDK)",
      type: "external-api",
      direction: "bidirectional",
      provenance: {
        kind: "observation",
        confidence: "high",
        evidence: [{
          sourceFile: "src/slack/app.ts",
          evidenceType: "typescript-import",
          detail: "import from \"@slack/bolt\"",
        }],
      },
    });

    const result = validateSystemModel(model);
    assert.equal(result.valid, true);
  });

  it("rejects datastores supported only by scanner source files", () => {
    const model = minimalValidModel();
    (model.datastores as any[]).push({
      name: "SQLite (native)",
      type: "embedded-database",
      engine: "SQLite",
      provenance: {
        kind: "observation",
        confidence: "high",
        evidence: [{
          sourceFile: "src/docforce/scanner/database.ts",
          evidenceType: "source-import",
          detail: "import from \"node:sqlite\"",
        }],
      },
    });

    const result = validateSystemModel(model);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) =>
      e.message.includes("documentation tooling source"),
    ));
  });

  it("accepts custom scanner source paths for evidence-origin check", () => {
    const model = minimalValidModel();
    (model.integrations as any[]).push({
      name: "Test",
      type: "test",
      direction: "outbound",
      provenance: {
        kind: "observation",
        confidence: "high",
        evidence: [{
          sourceFile: "tools/scanner/detector.ts",
          evidenceType: "source-analysis",
        }],
      },
    });

    const result = validateSystemModel(model, {
      scannerSourcePaths: ["tools/scanner/"],
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.message.includes("documentation tooling source")));
  });

  it("validates relationships reference valid nodes", () => {
    const model = minimalValidModel();
    (model.components as any[]).push({
      id: "alpha",
      name: "alpha",
      path: "src/alpha",
      type: "module",
      provenance: validProvenance(),
    });
    (model.relationships as any[]).push({
      id: "rel:alpha:imports:nonexistent",
      from: "alpha",
      to: "nonexistent",
      type: "imports",
      classification: "observation",
      confidence: "high",
      evidence: [{ sourceFile: "src/alpha/index.ts", evidenceType: "typescript-import" }],
    });

    const result = validateSystemModel(model);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.message.includes("unknown node")));
  });

  it("accepts infra: docker-service relationship endpoints", () => {
    const model = minimalValidModel();
    (model.components as any[]).push({
      id: "app",
      name: "app",
      path: "app",
      type: "application",
      provenance: validProvenance(),
    });
    (model.infrastructure as any[]).push({
      type: "docker-service",
      name: "sidecar",
      detail: "Compose service sidecar",
      provenance: validProvenance(),
    });
    (model.relationships as any[]).push({
      id: "rel:app:calls-api:infra:sidecar",
      from: "app",
      to: "infra:sidecar",
      type: "calls-api",
      classification: "observation",
      confidence: "high",
      evidence: [{ sourceFile: "app/api.ts", evidenceType: "local-service-http" }],
    });

    const result = validateSystemModel(model);
    assert.equal(result.valid, true, result.errors.map((e) => e.message).join("; "));
  });

  it("validates observations must have evidence", () => {
    const model = minimalValidModel();
    (model.components as any[]).push(
      { id: "a", name: "a", path: "src/a", type: "module", provenance: validProvenance() },
      { id: "b", name: "b", path: "src/b", type: "module", provenance: validProvenance() },
    );
    (model.relationships as any[]).push({
      id: "rel:a:imports:b",
      from: "a",
      to: "b",
      type: "imports",
      classification: "observation",
      confidence: "high",
      evidence: [],
    });

    const result = validateSystemModel(model);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.message.includes("direct evidence")));
  });

  it("warns on unknown-classification relationships", () => {
    const model = minimalValidModel();
    (model.components as any[]).push(
      { id: "a", name: "a", path: "src/a", type: "module", provenance: validProvenance() },
      { id: "b", name: "b", path: "src/b", type: "module", provenance: validProvenance() },
    );
    (model.relationships as any[]).push({
      id: "rel:a:imports:b",
      from: "a",
      to: "b",
      type: "imports",
      classification: "unknown",
      confidence: "low",
      evidence: [],
    });

    const result = validateSystemModel(model);
    assert.ok(result.warnings.some((w) => w.message.includes("Unknown-classification")));
  });

  it("warns on self-relationships", () => {
    const model = minimalValidModel();
    (model.components as any[]).push(
      { id: "a", name: "a", path: "src/a", type: "module", provenance: validProvenance() },
    );
    (model.relationships as any[]).push({
      id: "rel:a:imports:a",
      from: "a",
      to: "a",
      type: "imports",
      classification: "observation",
      confidence: "high",
      evidence: [{ sourceFile: "src/a/index.ts", evidenceType: "typescript-import" }],
    });

    const result = validateSystemModel(model);
    assert.ok(result.warnings.some((w) => w.message.includes("Self-relationship")));
  });

  it("validates relationship type is from controlled vocabulary", () => {
    const model = minimalValidModel();
    (model.components as any[]).push(
      { id: "a", name: "a", path: "src/a", type: "module", provenance: validProvenance() },
      { id: "b", name: "b", path: "src/b", type: "module", provenance: validProvenance() },
    );
    (model.relationships as any[]).push({
      id: "rel:a:unknown-type:b",
      from: "a",
      to: "b",
      type: "unknown-type",
      classification: "observation",
      confidence: "high",
      evidence: [{ sourceFile: "src/a/index.ts", evidenceType: "test" }],
    });

    const result = validateSystemModel(model);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.message.includes("Unknown relationship type")));
  });

  it("warns when evidence type does not support relationship type", () => {
    const model = minimalValidModel();
    (model.components as any[]).push(
      { id: "a", name: "a", path: "src/a", type: "module", provenance: validProvenance() },
      { id: "b", name: "b", path: "src/b", type: "module", provenance: validProvenance() },
    );
    (model.relationships as any[]).push({
      id: "rel:a:calls-api:b",
      from: "a",
      to: "b",
      type: "calls-api",
      classification: "observation",
      confidence: "high",
      evidence: [{ sourceFile: "src/a/index.ts", evidenceType: "module-import" }],
    });

    const result = validateSystemModel(model);
    assert.ok(result.warnings.some((w) => w.message.includes("does not semantically support")));
  });

  it("does not warn when evidence type supports relationship type", () => {
    const model = minimalValidModel();
    (model.components as any[]).push(
      { id: "a", name: "a", path: "src/a", type: "module", provenance: validProvenance() },
      { id: "b", name: "b", path: "src/b", type: "module", provenance: validProvenance() },
    );
    (model.relationships as any[]).push({
      id: "rel:a:imports:b",
      from: "a",
      to: "b",
      type: "imports",
      classification: "observation",
      confidence: "high",
      evidence: [{ sourceFile: "src/a/index.ts", evidenceType: "module-import" }],
    });

    const result = validateSystemModel(model);
    assert.ok(!result.warnings.some((w) => w.message.includes("does not semantically support")));
  });
});
