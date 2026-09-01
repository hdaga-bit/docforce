import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compareModels } from "./modelDiff.js";
import { classifyImpact } from "./impactClassifier.js";
import { DOCUMENT_REGISTRY, findAffectedArtifacts, getRegisteredArtifacts } from "./documentRegistry.js";
import { validateImpactReport } from "./validation.js";
import { getChangedFiles } from "./gitComparison.js";
import { classifyFile } from "./fileClassifier.js";
import type { SystemModel, Relationship } from "../model/types.js";
import type { ModelDelta, FileChange, ChangeImpactReport } from "./types.js";
import { EMPTY_COVERAGE } from "../model/builder.js";

function makeModel(overrides: Partial<SystemModel> = {}): SystemModel {
  return {
    metadata: {
      schemaVersion: "0.7.0",
      docforceVersion: "0.7.0",
      repositoryName: "test-repo",
      repositoryRoot: "/tmp/test",
      git: { commitSha: "abc123", branch: "main", dirty: false },
      generatedAt: "2026-01-01T00:00:00Z",
      configHash: "1234567890abcdef",
    },
    product: { name: "TestApp", type: "application", description: "Test" },
    runtime: [],
    languages: [],
    technologies: overrides.technologies ?? [],
    components: overrides.components ?? [],
    datastores: overrides.datastores ?? [],
    integrations: overrides.integrations ?? [],
    infrastructure: overrides.infrastructure ?? [],
    workflows: [],
    relationships: overrides.relationships ?? [],
    unknowns: [],
    apiRoutes: [],
    devices: [],
    coverage: EMPTY_COVERAGE,
    ...overrides,
  };
}

const obs = (file: string): any => ({
  kind: "observation", confidence: "high",
  evidence: [{ sourceFile: file, evidenceType: "source-analysis" }],
});

describe("Model Comparison", () => {
  it("Scenario A — Cosmetic change: identical models produce empty delta", () => {
    const model = makeModel({
      components: [{ id: "app", name: "app", path: "src/app", type: "module", provenance: obs("src/app/index.ts") }],
    });
    const delta = compareModels(model, model);
    assert.ok(delta.isEmpty);
    assert.equal(delta.entityChanges.length, 0);
    assert.equal(delta.relationshipChanges.length, 0);
  });

  it("Scenario B — New dependency: detects added technology", () => {
    const base = makeModel();
    const head = makeModel({
      technologies: [{
        name: "Redis", category: "database", provenance: obs("package.json"),
      }],
    });
    const delta = compareModels(base, head);
    assert.ok(!delta.isEmpty);
    const added = delta.entityChanges.find((e) => e.name === "Redis" && e.changeType === "added");
    assert.ok(added);
    assert.equal(added!.domain, "technologies");
  });

  it("Scenario C — Internal import added: detects relationship change", () => {
    const base = makeModel({
      components: [
        { id: "a", name: "a", path: "src/a", type: "module", provenance: obs("src/a/index.ts") },
        { id: "b", name: "b", path: "src/b", type: "module", provenance: obs("src/b/index.ts") },
      ],
    });
    const head = makeModel({
      components: [
        { id: "a", name: "a", path: "src/a", type: "module", provenance: obs("src/a/index.ts") },
        { id: "b", name: "b", path: "src/b", type: "module", provenance: obs("src/b/index.ts") },
      ],
      relationships: [{
        id: "rel:a:imports:b", from: "a", to: "b", type: "imports",
        classification: "observation", confidence: "high",
        evidence: [{ sourceFile: "src/a/main.ts", evidenceType: "module-import" }],
      }] as any,
    });
    const delta = compareModels(base, head);
    assert.ok(!delta.isEmpty);
    assert.equal(delta.relationshipChanges.length, 1);
    assert.equal(delta.relationshipChanges[0]!.changeType, "added");
    assert.ok(delta.changedDomains.has("relationships"));
  });

  it("Scenario D — Datastore replacement: detects added and removed", () => {
    const base = makeModel({
      datastores: [{ name: "SQLite", type: "embedded-database", provenance: obs("package.json") }],
    });
    const head = makeModel({
      datastores: [{ name: "PostgreSQL", type: "relational-database", provenance: obs("package.json") }],
    });
    const delta = compareModels(base, head);
    assert.ok(!delta.isEmpty);
    const removed = delta.entityChanges.find((e) => e.name === "SQLite" && e.changeType === "removed");
    const added = delta.entityChanges.find((e) => e.name === "PostgreSQL" && e.changeType === "added");
    assert.ok(removed);
    assert.ok(added);
    assert.ok(delta.changedDomains.has("datastores"));
  });

  it("Scenario E — Component added: detects new component", () => {
    const base = makeModel({
      components: [{ id: "app", name: "app", path: "src/app", type: "module", provenance: obs("src/app/index.ts") }],
    });
    const head = makeModel({
      components: [
        { id: "app", name: "app", path: "src/app", type: "module", provenance: obs("src/app/index.ts") },
        { id: "queue", name: "queue", path: "src/queue", type: "module", provenance: obs("src/queue/index.ts") },
      ],
    });
    const delta = compareModels(base, head);
    assert.ok(!delta.isEmpty);
    const added = delta.entityChanges.find((e) => e.name === "queue" && e.changeType === "added");
    assert.ok(added);
    assert.equal(added!.domain, "components");
  });

  it("Scenario F — Component removed: detects removed component", () => {
    const base = makeModel({
      components: [
        { id: "app", name: "app", path: "src/app", type: "module", provenance: obs("src/app/index.ts") },
        { id: "legacy", name: "legacy", path: "src/legacy", type: "module", provenance: obs("src/legacy/index.ts") },
      ],
    });
    const head = makeModel({
      components: [{ id: "app", name: "app", path: "src/app", type: "module", provenance: obs("src/app/index.ts") }],
    });
    const delta = compareModels(base, head);
    assert.ok(!delta.isEmpty);
    const removed = delta.entityChanges.find((e) => e.name === "legacy" && e.changeType === "removed");
    assert.ok(removed);
  });

  it("Scenario J — No changes: produces empty delta", () => {
    const model = makeModel({
      technologies: [{ name: "TypeScript", category: "language", provenance: obs("tsconfig.json") }],
      components: [{ id: "app", name: "app", path: "src/app", type: "module", provenance: obs("src/app/index.ts") }],
    });
    const delta = compareModels(model, model);
    assert.ok(delta.isEmpty);
  });

  it("ignores volatile metadata differences", () => {
    const base = makeModel();
    const head: SystemModel = {
      ...base,
      metadata: {
        ...base.metadata,
        generatedAt: "2026-12-31T23:59:59Z",
        git: { commitSha: "def456", branch: "feature", dirty: true },
        configHash: "different",
      },
    };
    const delta = compareModels(base, head);
    assert.ok(delta.isEmpty);
  });
});

describe("Impact Classification", () => {
  it("Scenario A — Cosmetic: no impact for empty delta", () => {
    const delta: ModelDelta = {
      entityChanges: [],
      relationshipChanges: [],
      changedDomains: new Set(),
      isEmpty: true,
    };
    const result = classifyImpact(delta, [{ path: "src/app/styles.css", changeType: "modified" }]);
    assert.equal(result.overallImpactLevel, "none");
  });

  it("Scenario B — New dependency: HIGH impact", () => {
    const delta: ModelDelta = {
      entityChanges: [{ domain: "technologies", changeType: "added", name: "Redis" }],
      relationshipChanges: [],
      changedDomains: new Set(["technologies"]),
      isEmpty: false,
    };
    const result = classifyImpact(delta, []);
    assert.equal(result.overallImpactLevel, "high");
  });

  it("Scenario C — Internal import: MEDIUM impact", () => {
    const delta: ModelDelta = {
      entityChanges: [],
      relationshipChanges: [{ changeType: "added", from: "a", to: "b", type: "imports" }],
      changedDomains: new Set(["relationships"]),
      isEmpty: false,
    };
    const result = classifyImpact(delta, []);
    assert.equal(result.overallImpactLevel, "medium");
  });

  it("Scenario D — Datastore replacement: ARCHITECTURAL impact", () => {
    const delta: ModelDelta = {
      entityChanges: [
        { domain: "datastores", changeType: "removed", name: "SQLite" },
        { domain: "datastores", changeType: "added", name: "PostgreSQL" },
      ],
      relationshipChanges: [],
      changedDomains: new Set(["datastores"]),
      isEmpty: false,
    };
    const result = classifyImpact(delta, []);
    assert.equal(result.overallImpactLevel, "architectural");
  });

  it("Scenario E — Component added: HIGH impact", () => {
    const delta: ModelDelta = {
      entityChanges: [{ domain: "components", changeType: "added", name: "queue" }],
      relationshipChanges: [],
      changedDomains: new Set(["components"]),
      isEmpty: false,
    };
    const result = classifyImpact(delta, []);
    assert.equal(result.overallImpactLevel, "high");
  });

  it("Scenario G — Presentation change: LOW impact", () => {
    const delta: ModelDelta = {
      entityChanges: [{ domain: "architecture-presentation", changeType: "modified", name: "includeInOverview" }],
      relationshipChanges: [],
      changedDomains: new Set(["architecture-presentation"]),
      isEmpty: false,
    };
    const result = classifyImpact(delta, []);
    assert.equal(result.overallImpactLevel, "low");
  });

  it("Scenario I — Function body change with no model delta: manual review", () => {
    const delta: ModelDelta = {
      entityChanges: [],
      relationshipChanges: [],
      changedDomains: new Set(),
      isEmpty: true,
    };
    const fileChanges: FileChange[] = [
      { path: "src/orchestrator/runner.ts", changeType: "modified" },
    ];
    const result = classifyImpact(delta, fileChanges);
    assert.equal(result.overallImpactLevel, "none");
    assert.ok(result.manualReviewRecommended);
  });

  it("Scenario J — No changes: no impact, no manual review", () => {
    const delta: ModelDelta = {
      entityChanges: [],
      relationshipChanges: [],
      changedDomains: new Set(),
      isEmpty: true,
    };
    const result = classifyImpact(delta, []);
    assert.equal(result.overallImpactLevel, "none");
    assert.ok(!result.manualReviewRecommended);
  });
});

describe("Document Registry", () => {
  it("all original artifacts remain registered", () => {
    const artifacts = getRegisteredArtifacts();
    assert.ok(artifacts.includes("technical-overview.md"));
    assert.ok(artifacts.includes("technology-inventory.md"));
    assert.ok(artifacts.includes("architecture.mmd"));
    assert.ok(artifacts.includes("dependency-graph.mmd"));
    assert.ok(artifacts.includes("architecture-evidence.md"));
    assert.ok(artifacts.includes("technical-architecture.md"));
  });

  it("technology change affects correct artifacts", () => {
    const affected = findAffectedArtifacts(new Set(["technologies"]));
    const names = affected.map((a) => a.artifact);
    assert.ok(names.includes("technical-overview.md"));
    assert.ok(names.includes("technology-inventory.md"));
    assert.ok(names.includes("technical-architecture.md"));
    assert.ok(!names.includes("dependency-graph.mmd"));
  });

  it("relationship change affects dependency graph and evidence", () => {
    const affected = findAffectedArtifacts(new Set(["relationships"]));
    const names = affected.map((a) => a.artifact);
    assert.ok(names.includes("dependency-graph.mmd"));
    assert.ok(names.includes("architecture-evidence.md"));
    assert.ok(names.includes("architecture.mmd"));
    assert.ok(names.includes("technical-overview.md"));
    assert.ok(names.includes("technical-architecture.md"));
  });

  it("architecture-presentation change affects architecture diagrams and the flagship document", () => {
    const affected = findAffectedArtifacts(new Set(["architecture-presentation"]));
    const names = affected.map((a) => a.artifact);
    assert.ok(names.includes("architecture.mmd"));
    assert.ok(names.includes("technical-architecture.md"));
    assert.ok(!names.includes("dependency-graph.mmd"));
    assert.ok(!names.includes("technology-inventory.md"));
  });
});

describe("Impact Document Impacts", () => {
  it("Scenario B — technology added affects technical-overview and inventory", () => {
    const delta: ModelDelta = {
      entityChanges: [{ domain: "technologies", changeType: "added", name: "Redis" }],
      relationshipChanges: [],
      changedDomains: new Set(["technologies"]),
      isEmpty: false,
    };
    const result = classifyImpact(delta, []);
    const overview = result.documentImpacts.find((d) => d.artifact === "technical-overview.md");
    const inventory = result.documentImpacts.find((d) => d.artifact === "technology-inventory.md");
    const depGraph = result.documentImpacts.find((d) => d.artifact === "dependency-graph.mmd");
    assert.ok(overview?.affected);
    assert.ok(inventory?.affected);
    assert.ok(!depGraph?.affected);
  });

  it("Scenario G — presentation change affects architecture diagrams and the flagship document", () => {
    const delta: ModelDelta = {
      entityChanges: [{ domain: "architecture-presentation", changeType: "modified", name: "includeInOverview" }],
      relationshipChanges: [],
      changedDomains: new Set(["architecture-presentation"]),
      isEmpty: false,
    };
    const result = classifyImpact(delta, []);
    const arch = result.documentImpacts.find((d) => d.artifact === "architecture.mmd");
    const flagship = result.documentImpacts.find((d) => d.artifact === "technical-architecture.md");
    const depGraph = result.documentImpacts.find((d) => d.artifact === "dependency-graph.mmd");
    assert.ok(arch?.affected);
    assert.ok(flagship?.affected);
    assert.ok(!depGraph?.affected);
  });
});

describe("Impact Validation", () => {
  it("validates a well-formed report", () => {
    const report: ChangeImpactReport = {
      baseRef: "HEAD~1",
      headRef: "HEAD",
      generatedAt: new Date().toISOString(),
      docforceVersion: "0.7.0",
      fileChanges: [],
      modelDelta: {
        entityChanges: [],
        relationshipChanges: [],
        changedDomains: new Set(),
        isEmpty: true,
      },
      overallImpactLevel: "none",
      manualReviewRecommended: false,
      documentImpacts: DOCUMENT_REGISTRY.map((d) => ({
        artifact: d.artifact,
        affected: false,
        impactLevel: "none" as const,
        reason: "No changes",
        triggeringDomains: [],
      })),
      unknowns: [],
    };
    const result = validateImpactReport(report);
    assert.ok(result.valid);
  });

  it("rejects document not in registry", () => {
    const report: ChangeImpactReport = {
      baseRef: "HEAD~1",
      headRef: "HEAD",
      generatedAt: new Date().toISOString(),
      docforceVersion: "0.7.0",
      fileChanges: [],
      modelDelta: {
        entityChanges: [],
        relationshipChanges: [],
        changedDomains: new Set(),
        isEmpty: true,
      },
      overallImpactLevel: "none",
      manualReviewRecommended: false,
      documentImpacts: [{
        artifact: "nonexistent.md",
        affected: false,
        impactLevel: "none",
        reason: "No changes",
        triggeringDomains: [],
      }],
      unknowns: [],
    };
    const result = validateImpactReport(report);
    assert.ok(!result.valid);
    assert.ok(result.errors.some((e) => e.includes("nonexistent.md")));
  });

  it("rejects unknown domain in entity changes", () => {
    const report: ChangeImpactReport = {
      baseRef: "HEAD~1",
      headRef: "HEAD",
      generatedAt: new Date().toISOString(),
      docforceVersion: "0.7.0",
      fileChanges: [],
      modelDelta: {
        entityChanges: [{ domain: "banana" as any, changeType: "added", name: "thing" }],
        relationshipChanges: [],
        changedDomains: new Set(["banana" as any]),
        isEmpty: false,
      },
      overallImpactLevel: "low",
      manualReviewRecommended: false,
      documentImpacts: [],
      unknowns: [],
    };
    const result = validateImpactReport(report);
    assert.ok(!result.valid);
    assert.ok(result.errors.some((e) => e.includes("unknown domain")));
  });

  it("flags affected document without triggering domains", () => {
    const report: ChangeImpactReport = {
      baseRef: "HEAD~1",
      headRef: "HEAD",
      generatedAt: new Date().toISOString(),
      docforceVersion: "0.7.0",
      fileChanges: [],
      modelDelta: {
        entityChanges: [],
        relationshipChanges: [],
        changedDomains: new Set(),
        isEmpty: true,
      },
      overallImpactLevel: "none",
      manualReviewRecommended: false,
      documentImpacts: [{
        artifact: "technical-overview.md",
        affected: true,
        impactLevel: "low",
        reason: "No reason",
        triggeringDomains: [],
      }],
      unknowns: [],
    };
    const result = validateImpactReport(report);
    assert.ok(!result.valid);
    assert.ok(result.errors.some((e) => e.includes("no triggering domains")));
  });
});

describe("Git File Comparison", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `docforce-git-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    execSync("git init", { cwd: tempDir, stdio: "pipe" });
    execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: "pipe" });
    execSync('git config user.name "Test"', { cwd: tempDir, stdio: "pipe" });
  });

  afterEach(() => {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  it("Scenario H — detects file rename", () => {
    writeFileSync(join(tempDir, "old.ts"), "export const x = 1;");
    execSync("git add . && git commit -m 'init'", { cwd: tempDir, stdio: "pipe" });

    execSync("git mv old.ts new.ts", { cwd: tempDir, stdio: "pipe" });
    execSync("git add . && git commit -m 'rename'", { cwd: tempDir, stdio: "pipe" });

    const changes = getChangedFiles(tempDir, "HEAD~1", "HEAD");
    assert.ok(changes.length > 0);
    const renamed = changes.find((c) => c.changeType === "renamed");
    const added = changes.find((c) => c.changeType === "added" && c.path === "new.ts");
    assert.ok(renamed || added, "Should detect rename or add");
  });

  it("detects added file", () => {
    writeFileSync(join(tempDir, "base.ts"), "export const x = 1;");
    execSync("git add . && git commit -m 'init'", { cwd: tempDir, stdio: "pipe" });

    writeFileSync(join(tempDir, "new.ts"), "export const y = 2;");
    execSync("git add . && git commit -m 'add'", { cwd: tempDir, stdio: "pipe" });

    const changes = getChangedFiles(tempDir, "HEAD~1", "HEAD");
    assert.equal(changes.length, 1);
    assert.equal(changes[0]!.changeType, "added");
    assert.equal(changes[0]!.path, "new.ts");
  });

  it("detects modified file", () => {
    writeFileSync(join(tempDir, "app.ts"), "export const x = 1;");
    execSync("git add . && git commit -m 'init'", { cwd: tempDir, stdio: "pipe" });

    writeFileSync(join(tempDir, "app.ts"), "export const x = 2;");
    execSync("git add . && git commit -m 'modify'", { cwd: tempDir, stdio: "pipe" });

    const changes = getChangedFiles(tempDir, "HEAD~1", "HEAD");
    assert.equal(changes.length, 1);
    assert.equal(changes[0]!.changeType, "modified");
  });

  it("returns empty for no changes", () => {
    writeFileSync(join(tempDir, "app.ts"), "export const x = 1;");
    execSync("git add . && git commit -m 'init'", { cwd: tempDir, stdio: "pipe" });

    const changes = getChangedFiles(tempDir, "HEAD", "HEAD");
    assert.equal(changes.length, 0);
  });
});

describe("File classification after extraction", () => {
  it("treats installed packages and leftover DocForce paths as non-product", () => {
    assert.equal(classifyFile("node_modules/@mary/docforce/dist/cli.js"), "docforce-internal");
    assert.equal(classifyFile("packages/docforce/src/cli.ts"), "docforce-internal");
    assert.equal(classifyFile("src/docforce/cli.ts"), "docforce-internal");
    assert.equal(classifyFile(".docforce/reports/pr-assessment.md"), "generated-documentation");
    assert.equal(classifyFile("src/tasks/service.ts"), "source");
  });
});
