import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateTechnicalOverview } from "./technicalOverview.js";
import { generateTechnologyInventory } from "./technologyInventory.js";
import { generateArchitectureDiagram, generateDependencyGraph } from "./architectureDiagram.js";
import { generateSoftwareArchitecture } from "./architectureViews.js";
import { generateAllDocs } from "./index.js";
import type { SystemModel, Provenance } from "../model/types.js";
import type { DocforceConfig } from "../config/types.js";
import { DEFAULT_PR_CONFIG } from "../config/index.js";
import { EMPTY_COVERAGE } from "../model/builder.js";

function validProv(sourceFile = "package.json"): Provenance {
  return {
    kind: "observation",
    confidence: "high",
    evidence: [{ sourceFile, evidenceType: "test" }],
  };
}

function testModel(): SystemModel {
  return {
    metadata: {
      schemaVersion: "0.7.0",
      docforceVersion: "0.7.0",
      repositoryName: "test-repo",
      repositoryRoot: "/tmp/test",
      git: { commitSha: "abc123def", branch: "main", dirty: false },
      generatedAt: "2026-08-31T12:00:00.000Z",
      configHash: "abcdef01",
    },
    product: {
      name: "TestProduct",
      type: "web-service",
      description: "A test product for documentation generation",
    },
    runtime: [{
      name: "Node.js",
      version: "22",
      provenance: validProv(),
    }],
    languages: [{
      name: "TypeScript",
      version: "7.0.2",
      provenance: validProv(),
    }],
    technologies: [
      {
        name: "@slack/bolt",
        version: "5.0.0",
        category: "messaging",
        purpose: "Slack bot framework",
        provenance: validProv(),
      },
      {
        name: "zod",
        version: "4.4.3",
        category: "validation",
        purpose: "Schema validation",
        provenance: validProv(),
      },
    ],
    components: [
      {
        id: "slack",
        name: "slack",
        path: "src/slack",
        description: "Exports: App, handlers",
        type: "module",
        provenance: validProv("src/slack"),
      },
      {
        id: "tasks",
        name: "tasks",
        path: "src/tasks",
        type: "module",
        provenance: validProv("src/tasks"),
      },
    ],
    datastores: [{
      name: "SQLite",
      type: "embedded-database",
      engine: "SQLite",
      location: "/opt/data/app.db",
      provenance: validProv(),
    }],
    integrations: [{
      name: "Slack (Bolt SDK)",
      type: "external-api",
      direction: "bidirectional",
      protocol: "WebSocket",
      provenance: validProv("src/slack/app.ts"),
    }],
    infrastructure: [{
      type: "systemd-service",
      name: "myapp",
      detail: "Description: My App; User: appuser",
      provenance: validProv("myapp.service"),
    }],
    workflows: [],
    relationships: [
      {
        id: "rel:slack:imports:tasks",
        from: "slack",
        to: "tasks",
        type: "imports" as const,
        classification: "observation" as const,
        confidence: "high" as const,
        evidence: [{ sourceFile: "src/slack/app.ts", evidenceType: "module-import", line: 5, detail: "imports ../tasks/service.js" }],
        description: "slack imports tasks",
      },
    ],
    unknowns: [
      {
        area: "CI/CD",
        description: "No CI/CD configuration detected",
        reason: "No .github/workflows found",
      },
      {
        area: "Architecture Rationale",
        description: "Engineering rationale not documented",
        reason: "No ADR or design documents found",
      },
    ],
    apiRoutes: [],
    devices: [],
    coverage: EMPTY_COVERAGE,
  };
}

function testConfig(): DocforceConfig {
  return {
    schemaVersion: "0.7.0",
    product: { name: "TestProduct", type: "web-service", description: "Test" },
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
  };
}

describe("Technical Overview Generator", () => {
  it("generates markdown with all required sections", () => {
    const md = generateTechnicalOverview(testModel());

    assert.ok(md.includes("## Product Technical Summary"));
    assert.ok(md.includes("## Architecture Overview"));
    assert.ok(md.includes("## Languages & Runtime"));
    assert.ok(md.includes("## Major Software Components"));
    assert.ok(md.includes("## External Integrations"));
    assert.ok(md.includes("## Data & Storage"));
    assert.ok(md.includes("## Deployment & Infrastructure"));
    assert.ok(md.includes("## Documentation Coverage & Unknowns"));
    assert.ok(!md.includes("## Architecture Rationale"));
    assert.ok(!md.includes("## Product Overview"));
  });

  it("includes product information from config, not invented", () => {
    const md = generateTechnicalOverview(testModel());
    assert.ok(md.includes("**Name:** TestProduct"));
    assert.ok(md.includes("**Type:** web-service"));
    assert.ok(md.includes("A test product for documentation generation"));
  });

  it("includes stable generation provenance without volatile metadata", () => {
    const md = generateTechnicalOverview(testModel());
    assert.ok(md.includes("Generated by DocForce"), "Should include stable provenance marker");
    assert.ok(md.includes("validated technical model"), "Should reference technical model");
    assert.ok(!md.includes("abc123def"), "Should not include commit SHA");
    assert.ok(!md.includes("main"), "Should not include branch name");
    assert.ok(!md.includes("v0."), "Should not include DocForce version");
    assert.ok(!md.includes("2026-08-31"), "Should not include generation date");
    assert.ok(!md.includes("[uncommitted changes]"), "Should not include dirty flag");
    assert.ok(!md.includes("Repository:"), "Should not include repository name");
  });

  it("lists unknown areas in coverage without architecture rationale", () => {
    const md = generateTechnicalOverview(testModel());
    assert.ok(md.includes("CI/CD"));
    assert.ok(md.includes("No CI/CD configuration detected"));
    assert.ok(!md.includes("### Architecture Rationale"));
    assert.ok(!md.includes("Engineering rationale not documented"));
  });

  it("includes documentation coverage statuses", () => {
    const md = generateTechnicalOverview(testModel());
    assert.ok(md.includes("software structure"));
    assert.ok(md.includes("discovered") || md.includes("partially represented") || md.includes("unavailable"));
  });
});

describe("Technology Inventory Generator", () => {
  it("generates markdown with tables", () => {
    const md = generateTechnologyInventory(testModel());

    assert.ok(md.includes("# TestProduct — Technology Inventory"));
    assert.ok(md.includes("## Languages & Runtimes"));
    assert.ok(md.includes("## Full Dependency Appendix"));
    assert.ok(md.includes("## Data & Storage"));
    assert.ok(md.includes("## Infrastructure & Deployment"));
    assert.ok(md.includes("## External Services / Integrations"));
  });

  it("includes evidence and confidence columns", () => {
    const md = generateTechnologyInventory(testModel());
    assert.ok(md.includes("Evidence"));
    assert.ok(md.includes("Confidence"));
    assert.ok(md.includes("`package.json`"));
  });
});

describe("Architecture Diagram Generator", () => {
  it("generates valid Mermaid syntax", () => {
    const mmd = generateArchitectureDiagram(testModel());

    assert.ok(mmd.includes("graph TD"));
    assert.ok(mmd.includes("subgraph Application"));
  });

  it("includes component nodes referenced by relationships", () => {
    const mmd = generateArchitectureDiagram(testModel());
    assert.ok(mmd.includes("slack"));
    assert.ok(mmd.includes("tasks"));
  });

  it("includes generation comment", () => {
    const mmd = generateArchitectureDiagram(testModel());
    assert.ok(mmd.includes("Generated by DocForce"));
    assert.ok(mmd.includes("evidence-backed"));
  });
});

describe("Document Generation Pipeline", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `docforce-test-gen-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes all registered output files", () => {
    const result = generateAllDocs(tmpDir, testConfig(), testModel());

    assert.equal(result.files.length, 13);
    assert.ok(existsSync(join(tmpDir, "docs", "generated", "technical-overview.md")));
    assert.ok(existsSync(join(tmpDir, "docs", "generated", "technology-inventory.md")));
    assert.ok(existsSync(join(tmpDir, "docs", "generated", "architecture.mmd")));
    assert.ok(existsSync(join(tmpDir, "docs", "generated", "system-overview.mmd")));
    assert.ok(existsSync(join(tmpDir, "docs", "generated", "software-architecture.mmd")));
    assert.ok(existsSync(join(tmpDir, "docs", "generated", "deployment-architecture.mmd")));
    assert.ok(existsSync(join(tmpDir, "docs", "generated", "data-architecture.mmd")));
    assert.ok(existsSync(join(tmpDir, "docs", "generated", "device-architecture.mmd")));
    assert.ok(existsSync(join(tmpDir, "docs", "generated", "dependency-graph.mmd")));
    assert.ok(existsSync(join(tmpDir, "docs", "generated", "architecture-evidence.md")));
    assert.ok(existsSync(join(tmpDir, "docs", "generated", "api-inventory.md")));
    assert.ok(existsSync(join(tmpDir, "docs", "generated", "configuration-inventory.md")));
    assert.ok(existsSync(join(tmpDir, "docs", "generated", "technical-architecture.md")));
  });

  it("generated files have non-zero bytes", () => {
    const result = generateAllDocs(tmpDir, testConfig(), testModel());
    for (const file of result.files) {
      assert.ok(file.bytes > 0, `${file.path} should have content`);
    }
  });

  it("technical overview contains all required sections", () => {
    generateAllDocs(tmpDir, testConfig(), testModel());
    const content = readFileSync(join(tmpDir, "docs", "generated", "technical-overview.md"), "utf-8");
    const requiredSections = [
      "Product Technical Summary",
      "Architecture Overview",
      "Languages & Runtime",
      "Major Software Components",
      "External Integrations",
      "Data & Storage",
      "Deployment & Infrastructure",
      "Documentation Coverage & Unknowns",
    ];
    for (const section of requiredSections) {
      assert.ok(content.includes(section), `Missing section: ${section}`);
    }
  });
});

describe("Architecture Overview Filtering", () => {
  function overviewModel(): SystemModel {
    return {
      ...testModel(),
      components: [
        {
          id: "slack",
          name: "slack",
          path: "src/slack",
          type: "module",
          displayName: "Slack Interface",
          provenance: validProv("src/slack"),
        },
        {
          id: "tasks",
          name: "tasks",
          path: "src/tasks",
          type: "module",
          displayName: "Task Store",
          provenance: validProv("src/tasks"),
        },
        {
          id: "config",
          name: "config",
          path: "src/config",
          type: "module",
          displayName: "Configuration",
          provenance: validProv("src/config"),
        },
      ],
      relationships: [
        {
          id: "rel:slack:imports:tasks",
          from: "slack",
          to: "tasks",
          type: "imports" as const,
          classification: "observation" as const,
          confidence: "high" as const,
          evidence: [{ sourceFile: "src/slack/app.ts", evidenceType: "module-import" }],
        },
        {
          id: "rel:slack:imports:config",
          from: "slack",
          to: "config",
          type: "imports" as const,
          classification: "observation" as const,
          confidence: "high" as const,
          evidence: [{ sourceFile: "src/slack/app.ts", evidenceType: "module-import" }],
        },
        {
          id: "rel:config:imports:tasks",
          from: "config",
          to: "tasks",
          type: "imports" as const,
          classification: "observation" as const,
          confidence: "high" as const,
          evidence: [{ sourceFile: "src/config/index.ts", evidenceType: "module-import" }],
        },
      ],
    };
  }

  it("overview filtering only shows includeInOverview components", () => {
    const model = overviewModel();
    const config: DocforceConfig = {
      ...testConfig(),
      architecture: {
        components: {
          slack: { displayName: "Slack Interface", includeInOverview: true },
          tasks: { displayName: "Task Store", includeInOverview: true },
          config: { displayName: "Configuration", includeInOverview: false },
        },
      },
    };

    const overview = generateSoftwareArchitecture(model, config);
    assert.ok(overview.includes("Slack Interface"), "slack should be in software architecture");
    assert.ok(overview.includes("Task Store"), "tasks should be in software architecture");
    assert.ok(!overview.includes("Configuration"), "config should NOT be in software architecture");
  });

  it("dependency graph preserves all relationships", () => {
    const model = overviewModel();
    const depGraph = generateDependencyGraph(model);
    assert.ok(depGraph.includes("Slack Interface"), "slack should be in dep graph");
    assert.ok(depGraph.includes("Task Store"), "tasks should be in dep graph");
    assert.ok(depGraph.includes("Configuration"), "config should be in dep graph");
  });

  it("system model is unaffected by presentation filtering", () => {
    const model = overviewModel();
    const config: DocforceConfig = {
      ...testConfig(),
      architecture: {
        components: {
          slack: { displayName: "Slack Interface", includeInOverview: true },
          tasks: { displayName: "Task Store", includeInOverview: true },
          config: { displayName: "Configuration", includeInOverview: false },
        },
      },
    };

    generateSoftwareArchitecture(model, config);

    assert.equal(model.components.length, 3, "Model components should not be mutated");
    assert.equal(model.relationships.length, 3, "Model relationships should not be mutated");
  });
});
