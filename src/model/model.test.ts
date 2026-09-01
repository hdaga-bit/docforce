import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildSystemModel, buildMetadata, buildProductInfo, getGitInfo } from "./builder.js";
import type { DocforceConfig } from "../config/types.js";
import { DEFAULT_PR_CONFIG } from "../config/index.js";
import { DOCFORCE_VERSION, MODEL_SCHEMA_VERSION } from "../version.js";
import type { ScanResults } from "./builder.js";
import { EMPTY_COVERAGE } from "./builder.js";

function makeConfig(overrides?: Partial<DocforceConfig>): DocforceConfig {
  return {
    schemaVersion: "0.2.0",
    product: { name: "TestApp", type: "web-app", description: "Test" },
    scanning: { rootDir: ".", include: [], exclude: [] },
    analysis: { exclude: [] },
    architecture: { components: {} },
    output: {
      systemModel: ".docforce/system-model.json",
      docs: {
        technicalOverview: "docs/generated/technical-overview.md",
        technologyInventory: "docs/generated/technology-inventory.md",
        architectureDiagram: "docs/generated/architecture.mmd",
        dependencyGraph: "docs/generated/dependency-graph.mmd",
        architectureEvidence: "docs/generated/architecture-evidence.md",
      },
    },
    documentation: { allowedRoots: ["docs/"], aiAssisted: [] },
    ai: {},
    pr: DEFAULT_PR_CONFIG,
    ...overrides,
  };
}

function emptyScanResults(): ScanResults {
  return {
    runtime: [],
    languages: [],
    relationships: [],
    technologies: [],
    components: [],
    datastores: [],
    integrations: [],
    infrastructure: [],
    workflows: [],
    unknowns: [],
    apiRoutes: [],
    devices: [],
    coverage: EMPTY_COVERAGE,
  };
}

describe("System Model Builder", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `docforce-test-model-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("builds metadata with required fields", () => {
    writeFileSync(join(tmpDir, "docforce.yml"), "product:\n  name: Test\n");
    const meta = buildMetadata(tmpDir, join(tmpDir, "docforce.yml"));

    assert.equal(meta.schemaVersion, MODEL_SCHEMA_VERSION);
    assert.equal(meta.docforceVersion, DOCFORCE_VERSION);
    assert.ok(meta.generatedAt);
    assert.ok(meta.configHash);
    assert.ok(meta.configHash !== "unknown");
    assert.ok(meta.git);
    assert.ok(meta.git.dirty === null || meta.git.dirty === true || meta.git.dirty === false);
  });

  it("builds product info from config", () => {
    const config = makeConfig({ product: { name: "MyApp", type: "service", description: "A service" } });
    const product = buildProductInfo(config);

    assert.equal(product.name, "MyApp");
    assert.equal(product.type, "service");
    assert.equal(product.description, "A service");
  });

  it("builds complete system model combining config and scan results", () => {
    writeFileSync(join(tmpDir, "docforce.yml"), "product:\n  name: Test\n");
    const config = makeConfig();
    const scans: ScanResults = {
      ...emptyScanResults(),
      runtime: [{
        name: "Node.js",
        provenance: {
          kind: "observation",
          confidence: "high",
          evidence: [{ sourceFile: "package.json", evidenceType: "manifest" }],
        },
      }],
      unknowns: [{ area: "CI/CD", description: "No CI", reason: "No workflows" }],
    };

    const model = buildSystemModel(tmpDir, join(tmpDir, "docforce.yml"), config, scans);

    assert.equal(model.product.name, "TestApp");
    assert.equal(model.runtime.length, 1);
    assert.equal(model.runtime[0]!.name, "Node.js");
    assert.equal(model.unknowns.length, 1);
    assert.ok(model.metadata.generatedAt);
  });

  it("metadata includes docforce version", () => {
    writeFileSync(join(tmpDir, "docforce.yml"), "product:\n  name: Test\n");
    const meta = buildMetadata(tmpDir, join(tmpDir, "docforce.yml"));
    assert.equal(meta.docforceVersion, DOCFORCE_VERSION);
  });

  it("metadata includes config hash for change detection", () => {
    writeFileSync(join(tmpDir, "docforce.yml"), "product:\n  name: Test\n");
    const meta1 = buildMetadata(tmpDir, join(tmpDir, "docforce.yml"));

    writeFileSync(join(tmpDir, "docforce.yml"), "product:\n  name: Changed\n");
    const meta2 = buildMetadata(tmpDir, join(tmpDir, "docforce.yml"));

    assert.notEqual(meta1.configHash, meta2.configHash);
  });

  it("getGitInfo returns structured git metadata", () => {
    const git = getGitInfo(tmpDir);
    assert.ok(git.commitSha === null || typeof git.commitSha === "string");
    assert.ok(git.branch === null || typeof git.branch === "string");
    assert.ok(git.dirty === null || typeof git.dirty === "boolean");
  });

  it("getGitInfo captures commit SHA even in dirty repo", () => {
    execSync("git init", { cwd: tmpDir, stdio: "pipe" });
    execSync('git config user.email "test@docforce.test"', { cwd: tmpDir, stdio: "pipe" });
    execSync('git config user.name "DocForce Test"', { cwd: tmpDir, stdio: "pipe" });
    writeFileSync(join(tmpDir, "readme.txt"), "x\n");
    execSync("git add -A && git commit -m init", { cwd: tmpDir, stdio: "pipe" });
    writeFileSync(join(tmpDir, "readme.txt"), "dirty\n");

    const git = getGitInfo(tmpDir);
    assert.ok(git.commitSha !== null);
    assert.equal(git.commitSha!.length, 40);
    assert.equal(git.dirty, true);
  });

  it("getGitInfo returns nulls for non-git directory", () => {
    const git = getGitInfo(tmpDir);
    assert.equal(git.commitSha, null);
    assert.equal(git.branch, null);
    assert.equal(git.dirty, null);
  });
});
