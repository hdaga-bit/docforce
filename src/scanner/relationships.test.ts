import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildInternalImportGraph,
  buildExternalIntegrationRelationships,
  buildDatastoreRelationships,
  detectLocalConstantIntegrations,
} from "./relationships.js";
import { normalizeExternalEntities } from "./normalize.js";
import { evidenceSupportsRelationship } from "../model/evidenceTypes.js";
import type { ComponentInfo, IntegrationInfo, DatastoreInfo } from "../model/types.js";

function makeProv(sourceFile: string, evidenceType = "source-analysis") {
  return {
    kind: "observation" as const,
    confidence: "high" as const,
    evidence: [{ sourceFile, evidenceType }],
  };
}

describe("Internal Import Graph", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `docforce-rel-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves cross-component imports into relationships", () => {
    mkdirSync(join(tmpDir, "src", "alpha"), { recursive: true });
    mkdirSync(join(tmpDir, "src", "beta"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "alpha", "index.ts"), 'import { helper } from "../beta/utils.js";\nexport const a = helper;\n');
    writeFileSync(join(tmpDir, "src", "beta", "utils.ts"), "export function helper() { return 1; }\n");

    const components: ComponentInfo[] = [
      { id: "alpha", name: "alpha", path: "src/alpha", type: "module", provenance: makeProv("src/alpha") },
      { id: "beta", name: "beta", path: "src/beta", type: "module", provenance: makeProv("src/beta") },
    ];

    const rels = buildInternalImportGraph(tmpDir, components, []);
    assert.equal(rels.length, 1);
    assert.equal(rels[0]!.from, "alpha");
    assert.equal(rels[0]!.to, "beta");
    assert.equal(rels[0]!.type, "imports");
    assert.equal(rels[0]!.classification, "observation");
    assert.equal(rels[0]!.confidence, "high");
    assert.ok(rels[0]!.evidence.length > 0);
  });

  it("aggregates multiple file-level imports into one component relationship", () => {
    mkdirSync(join(tmpDir, "src", "a"), { recursive: true });
    mkdirSync(join(tmpDir, "src", "b"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "a", "one.ts"), 'import { x } from "../b/x.js";\n');
    writeFileSync(join(tmpDir, "src", "a", "two.ts"), 'import { y } from "../b/y.js";\n');
    writeFileSync(join(tmpDir, "src", "b", "x.ts"), "export const x = 1;\n");
    writeFileSync(join(tmpDir, "src", "b", "y.ts"), "export const y = 2;\n");

    const components: ComponentInfo[] = [
      { id: "a", name: "a", path: "src/a", type: "module", provenance: makeProv("src/a") },
      { id: "b", name: "b", path: "src/b", type: "module", provenance: makeProv("src/b") },
    ];

    const rels = buildInternalImportGraph(tmpDir, components, []);
    assert.equal(rels.length, 1, "Should have one aggregated relationship");
    assert.equal(rels[0]!.evidence.length, 2, "Should preserve both file-level evidence entries");
  });

  it("preserves file-level evidence during aggregation", () => {
    mkdirSync(join(tmpDir, "src", "x"), { recursive: true });
    mkdirSync(join(tmpDir, "src", "y"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "x", "a.ts"), 'import { z } from "../y/z.js";\n');
    writeFileSync(join(tmpDir, "src", "y", "z.ts"), "export const z = 1;\n");

    const components: ComponentInfo[] = [
      { id: "x", name: "x", path: "src/x", type: "module", provenance: makeProv("src/x") },
      { id: "y", name: "y", path: "src/y", type: "module", provenance: makeProv("src/y") },
    ];

    const rels = buildInternalImportGraph(tmpDir, components, []);
    assert.equal(rels[0]!.evidence[0]!.sourceFile, "src/x/a.ts");
    assert.ok(rels[0]!.evidence[0]!.detail?.includes("../y/z.js"));
  });

  it("ignores self-imports within same component", () => {
    mkdirSync(join(tmpDir, "src", "a"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "a", "one.ts"), 'import { two } from "./two.js";\n');
    writeFileSync(join(tmpDir, "src", "a", "two.ts"), "export const two = 2;\n");

    const components: ComponentInfo[] = [
      { id: "a", name: "a", path: "src/a", type: "module", provenance: makeProv("src/a") },
    ];

    const rels = buildInternalImportGraph(tmpDir, components, []);
    assert.equal(rels.length, 0, "Self-imports should not produce relationships");
  });

  it("respects analysis exclusions", () => {
    mkdirSync(join(tmpDir, "src", "app"), { recursive: true });
    mkdirSync(join(tmpDir, "src", "tooling"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "app", "main.ts"), 'import { tool } from "../tooling/index.js";\n');
    writeFileSync(join(tmpDir, "src", "tooling", "index.ts"), "export function tool() {}\n");

    const components: ComponentInfo[] = [
      { id: "app", name: "app", path: "src/app", type: "module", provenance: makeProv("src/app") },
      { id: "tooling", name: "tooling", path: "src/tooling", type: "module", provenance: makeProv("src/tooling") },
    ];

    const rels = buildInternalImportGraph(tmpDir, components, ["src/tooling/**"]);
    assert.equal(rels.length, 0, "Excluded components should not appear in relationships");
  });

  it("does not produce duplicate component edges", () => {
    mkdirSync(join(tmpDir, "src", "a"), { recursive: true });
    mkdirSync(join(tmpDir, "src", "b"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "a", "x.ts"), 'import { b1 } from "../b/b1.js";\nimport { b2 } from "../b/b2.js";\n');
    writeFileSync(join(tmpDir, "src", "b", "b1.ts"), "export const b1 = 1;\n");
    writeFileSync(join(tmpDir, "src", "b", "b2.ts"), "export const b2 = 2;\n");

    const components: ComponentInfo[] = [
      { id: "a", name: "a", path: "src/a", type: "module", provenance: makeProv("src/a") },
      { id: "b", name: "b", path: "src/b", type: "module", provenance: makeProv("src/b") },
    ];

    const rels = buildInternalImportGraph(tmpDir, components, []);
    const aToB = rels.filter((r) => r.from === "a" && r.to === "b");
    assert.equal(aToB.length, 1, "Should have exactly one a→b relationship");
    assert.equal(aToB[0]!.evidence.length, 2, "But with 2 evidence entries");
  });
});

describe("External Integration Relationships", () => {
  it("connects integration evidence to its source component", () => {
    const components: ComponentInfo[] = [
      { id: "slack", name: "slack", path: "src/slack", type: "module", provenance: makeProv("src/slack") },
    ];
    const integrations: IntegrationInfo[] = [
      {
        name: "Slack (Bolt SDK)",
        type: "external-api",
        direction: "bidirectional",
        protocol: "WebSocket",
        provenance: {
          kind: "observation",
          confidence: "high",
          evidence: [{ sourceFile: "src/slack/app.ts", evidenceType: "module-import", line: 1, detail: 'import from "@slack/bolt"' }],
        },
      },
    ];

    const rels = buildExternalIntegrationRelationships(components, integrations);
    assert.equal(rels.length, 1);
    assert.equal(rels[0]!.from, "slack");
    assert.ok(rels[0]!.to.startsWith("ext:"));
    assert.ok(rels[0]!.to.includes("slack"));
    assert.equal(rels[0]!.classification, "observation");
  });

  it("returns empty when evidence does not match any component", () => {
    const components: ComponentInfo[] = [
      { id: "app", name: "app", path: "src/app", type: "module", provenance: makeProv("src/app") },
    ];
    const integrations: IntegrationInfo[] = [
      {
        name: "TestAPI",
        type: "external-api",
        direction: "outbound",
        provenance: {
          kind: "observation",
          confidence: "high",
          evidence: [{ sourceFile: "lib/other.ts", evidenceType: "source-analysis" }],
        },
      },
    ];

    const rels = buildExternalIntegrationRelationships(components, integrations);
    assert.equal(rels.length, 0);
  });
});

describe("Datastore Relationships", () => {
  it("connects datastore source-import evidence to component", () => {
    const components: ComponentInfo[] = [
      { id: "tasks", name: "tasks", path: "src/tasks", type: "module", provenance: makeProv("src/tasks") },
    ];
    const datastores: DatastoreInfo[] = [
      {
        name: "SQLite (node:sqlite)",
        type: "embedded-database",
        engine: "SQLite",
        provenance: {
          kind: "observation",
          confidence: "high",
          evidence: [{ sourceFile: "src/tasks/sqliteStore.ts", evidenceType: "database-import", line: 3, detail: 'import from "node:sqlite"' }],
        },
      },
    ];

    const rels = buildDatastoreRelationships(components, datastores);
    assert.equal(rels.length, 1);
    assert.equal(rels[0]!.from, "tasks");
    assert.ok(rels[0]!.to.includes("store:"));
    assert.equal(rels[0]!.type, "persists-to");
  });
});

describe("Local Constant Resolution", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `docforce-const-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects GitHub API via local constant", () => {
    mkdirSync(join(tmpDir, "src", "github"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "github", "client.ts"), `
const GITHUB_API = "https://api.github.com";

export async function getRepo(owner: string, repo: string) {
  const response = await fetch(\`\${GITHUB_API}/repos/\${owner}/\${repo}\`);
  return response.json();
}
`);

    const results = detectLocalConstantIntegrations(tmpDir, []);
    assert.equal(results.length, 1);
    assert.equal(results[0]!.name, "GitHub API");
    assert.equal(results[0]!.constantName, "GITHUB_API");
    assert.equal(results[0]!.sourceFile, "src/github/client.ts");
  });

  it("does not resolve constants across files", () => {
    mkdirSync(join(tmpDir, "src", "config"), { recursive: true });
    mkdirSync(join(tmpDir, "src", "client"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "config", "api.ts"), `
export const GITHUB_API = "https://api.github.com";
`);
    writeFileSync(join(tmpDir, "src", "client", "fetch.ts"), `
import { GITHUB_API } from "../config/api.js";
const response = await fetch(\`\${GITHUB_API}/repos\`);
`);

    const results = detectLocalConstantIntegrations(tmpDir, []);
    const crossFileResults = results.filter((r) => r.sourceFile === "src/client/fetch.ts");
    assert.equal(crossFileResults.length, 0, "Must not resolve constants imported from other files");
  });

  it("does not match dynamic expressions", () => {
    mkdirSync(join(tmpDir, "src", "api"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "api", "client.ts"), `
const API_BASE = getConfig("api_url");
const response = await fetch(\`\${API_BASE}/repos\`);
`);

    const results = detectLocalConstantIntegrations(tmpDir, []);
    assert.equal(results.length, 0, "Dynamic expressions must not be resolved");
  });

  it("respects analysis exclusions", () => {
    mkdirSync(join(tmpDir, "src", "tooling"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "tooling", "scanner.ts"), `
const GITHUB_API = "https://api.github.com";
const x = \`\${GITHUB_API}/test\`;
`);

    const results = detectLocalConstantIntegrations(tmpDir, ["src/tooling/**"]);
    assert.equal(results.length, 0);
  });
});

describe("External Entity Normalization", () => {
  it("SQLite normalization merges two entities into one", () => {
    const integrations: IntegrationInfo[] = [
      {
        name: "SQLite (native)",
        type: "database",
        direction: "bidirectional",
        provenance: {
          kind: "observation",
          confidence: "high",
          evidence: [{ sourceFile: "src/tasks/store.ts", evidenceType: "module-import", detail: 'import "node:sqlite"' }],
        },
      },
    ];
    const datastores: DatastoreInfo[] = [
      {
        name: "SQLite (node:sqlite)",
        type: "embedded-database",
        engine: "SQLite",
        provenance: {
          kind: "observation",
          confidence: "high",
          evidence: [{ sourceFile: "src/tasks/sqliteStore.ts", evidenceType: "database-import" }],
        },
      },
    ];

    const result = normalizeExternalEntities(integrations, datastores);
    assert.equal(result.integrations.length, 0, "SQLite integration should be merged into datastore");
    const sqliteDs = result.datastores.find((d) => d.name === "SQLite");
    assert.ok(sqliteDs, "Should have a normalized SQLite datastore");
    assert.equal(sqliteDs.engine, "node:sqlite");
  });

  it("provenance is preserved during normalization", () => {
    const integrations: IntegrationInfo[] = [
      {
        name: "SQLite (native)",
        type: "database",
        direction: "bidirectional",
        provenance: {
          kind: "observation",
          confidence: "high",
          evidence: [{ sourceFile: "src/a.ts", evidenceType: "module-import" }],
        },
      },
    ];
    const datastores: DatastoreInfo[] = [
      {
        name: "SQLite (node:sqlite)",
        type: "embedded-database",
        engine: "SQLite",
        provenance: {
          kind: "observation",
          confidence: "high",
          evidence: [{ sourceFile: "src/b.ts", evidenceType: "database-import" }],
        },
      },
    ];

    const result = normalizeExternalEntities(integrations, datastores);
    const sqliteDs = result.datastores.find((d) => d.name === "SQLite");
    assert.ok(sqliteDs);
    assert.ok(sqliteDs.provenance.evidence.length >= 2, "All evidence should be preserved");
    const files = sqliteDs.provenance.evidence.map((e) => e.sourceFile);
    assert.ok(files.includes("src/a.ts"));
    assert.ok(files.includes("src/b.ts"));
  });
});

describe("Evidence Type Classification", () => {
  it("evidence type classification is correct", () => {
    assert.equal(evidenceSupportsRelationship("module-import", "imports"), true);
    assert.equal(evidenceSupportsRelationship("module-import", "depends-on"), true);
    assert.equal(evidenceSupportsRelationship("module-import", "calls-api"), false);
    assert.equal(evidenceSupportsRelationship("local-constant-resolution", "calls-api"), true);
    assert.equal(evidenceSupportsRelationship("api-request", "calls-api"), true);
    assert.equal(evidenceSupportsRelationship("database-import", "persists-to"), true);
    assert.equal(evidenceSupportsRelationship("process-spawn", "spawns"), true);
  });

  it("calls-api requires api-request or local-constant-resolution evidence", () => {
    assert.equal(evidenceSupportsRelationship("api-request", "calls-api"), true);
    assert.equal(evidenceSupportsRelationship("local-constant-resolution", "calls-api"), true);
    assert.equal(evidenceSupportsRelationship("module-import", "calls-api"), false);
    assert.equal(evidenceSupportsRelationship("database-import", "calls-api"), false);
  });

  it("unknown evidence types are permissively allowed", () => {
    assert.equal(evidenceSupportsRelationship("future-evidence-type", "calls-api"), true);
    assert.equal(evidenceSupportsRelationship("future-evidence-type", "depends-on"), true);
  });
});

describe("External Relationship Type Semantics", () => {
  it("module import produces depends-on not calls-api for external relationships", () => {
    const components: ComponentInfo[] = [
      { id: "slack", name: "slack", path: "src/slack", type: "module", provenance: makeProv("src/slack") },
    ];
    const integrations: IntegrationInfo[] = [
      {
        name: "Slack (Bolt SDK)",
        type: "external-api",
        direction: "bidirectional",
        protocol: "WebSocket",
        provenance: {
          kind: "observation",
          confidence: "high",
          evidence: [{ sourceFile: "src/slack/app.ts", evidenceType: "module-import", line: 1, detail: 'import from "@slack/bolt"' }],
        },
      },
    ];

    const rels = buildExternalIntegrationRelationships(components, integrations);
    assert.equal(rels.length, 1);
    assert.equal(rels[0]!.type, "depends-on", "Slack SDK should be depends-on, not calls-api");
  });

  it("GitHub API relationship is correctly calls-api with local-constant-resolution evidence", () => {
    const components: ComponentInfo[] = [
      { id: "github", name: "github", path: "src/github", type: "module", provenance: makeProv("src/github") },
    ];
    const integrations: IntegrationInfo[] = [
      {
        name: "GitHub API",
        type: "external-api",
        direction: "outbound",
        protocol: "REST",
        provenance: {
          kind: "inference",
          confidence: "medium",
          evidence: [{
            sourceFile: "src/github/client.ts",
            evidenceType: "local-constant-resolution",
            line: 5,
            detail: 'GITHUB_API = "https://api.github.com" → API call detected',
          }],
        },
      },
    ];

    const rels = buildExternalIntegrationRelationships(components, integrations);
    assert.equal(rels.length, 1);
    assert.equal(rels[0]!.type, "calls-api", "GitHub API should be calls-api with local-constant-resolution evidence");
  });

  it("Slack SDK relationship is depends-on with module-import evidence", () => {
    const components: ComponentInfo[] = [
      { id: "slack", name: "slack", path: "src/slack", type: "module", provenance: makeProv("src/slack") },
    ];
    const integrations: IntegrationInfo[] = [
      {
        name: "Slack (Bolt SDK)",
        type: "external-api",
        direction: "bidirectional",
        provenance: {
          kind: "observation",
          confidence: "high",
          evidence: [{ sourceFile: "src/slack/app.ts", evidenceType: "module-import" }],
        },
      },
    ];

    const rels = buildExternalIntegrationRelationships(components, integrations);
    assert.equal(rels[0]!.type, "depends-on", "Slack SDK with module-import should be depends-on");
  });
});
