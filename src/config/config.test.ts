import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, resolveConfigPath } from "./index.js";

describe("DocForce Config", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `docforce-test-config-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses a valid docforce.yml", () => {
    const yml = `
schemaVersion: "0.1.0"

product:
  name: TestProduct
  type: web-app
  description: A test product

scanning:
  rootDir: "."
  include:
    - "src/**"
    - "package.json"
  exclude:
    - "node_modules/**"

analysis:
  exclude:
    - "src/docforce/**"

architecture:
  components:
    slack:
      displayName: Slack Interface

output:
  systemModel: ".docforce/system-model.json"
  docs:
    technicalOverview: "docs/generated/technical-overview.md"
    technologyInventory: "docs/generated/technology-inventory.md"
    architectureDiagram: "docs/generated/architecture.mmd"
    architectureEvidence: "docs/generated/architecture-evidence.md"
`;
    writeFileSync(join(tmpDir, "docforce.yml"), yml);
    const config = loadConfig(join(tmpDir, "docforce.yml"));

    assert.equal(config.schemaVersion, "0.1.0");
    assert.equal(config.product.name, "TestProduct");
    assert.equal(config.product.type, "web-app");
    assert.equal(config.product.description, "A test product");
    assert.deepEqual(config.scanning.include, ["src/**", "package.json"]);
    assert.deepEqual(config.scanning.exclude, ["node_modules/**"]);
    assert.deepEqual(config.analysis.exclude, ["src/docforce/**"]);
    assert.ok(config.architecture.components?.["slack"]);
    assert.equal(config.architecture.components?.["slack"]?.displayName, "Slack Interface");
    assert.equal(config.output.systemModel, ".docforce/system-model.json");
    assert.equal(config.output.docs.technicalOverview, "docs/generated/technical-overview.md");
    assert.equal(config.output.docs.architectureEvidence, "docs/generated/architecture-evidence.md");
  });

  it("throws when product.name is missing", () => {
    const yml = `
schemaVersion: "0.1.0"

product:
  type: web-app
  description: missing name

scanning:
  rootDir: "."
`;
    writeFileSync(join(tmpDir, "docforce.yml"), yml);
    assert.throws(
      () => loadConfig(join(tmpDir, "docforce.yml")),
      /product\.name is required/,
    );
  });

  it("uses defaults for missing output paths", () => {
    const yml = `
product:
  name: Minimal
  type: tool
  description: Minimal config
`;
    writeFileSync(join(tmpDir, "docforce.yml"), yml);
    const config = loadConfig(join(tmpDir, "docforce.yml"));

    assert.equal(config.output.systemModel, ".docforce/system-model.json");
    assert.equal(config.output.docs.technicalOverview, "docs/generated/technical-overview.md");
  });

  it("resolveConfigPath joins repo root and default filename", () => {
    const result = resolveConfigPath("/some/repo");
    assert.ok(result.endsWith("docforce.yml"));
    assert.ok(result.startsWith("/some/repo"));
  });

  it("parses AI-assisted documentation targets", () => {
    const yml = `
schemaVersion: "0.7.0"
product:
  name: TestProduct
  type: web-app
  description: A test product
scanning:
  rootDir: "."
  include:
    - "src/**"
  exclude:
    - "node_modules/**"
analysis:
  exclude: []
output:
  systemModel: ".docforce/system-model.json"
  docs:
    technicalOverview: "docs/generated/technical-overview.md"
    technologyInventory: "docs/generated/technology-inventory.md"
    architectureDiagram: "docs/generated/architecture.mmd"
    architectureEvidence: "docs/generated/architecture-evidence.md"
documentation:
  allowedRoots:
    - "docs/"
  aiAssisted:
    reliability:
      path: docs/behavior.md
      sectionId: reliability.behavior
      allowCreateSection: true
ai:
  provider: claude
  claude:
    command: /usr/bin/claude
`;
    writeFileSync(join(tmpDir, "docforce.yml"), yml);
    const config = loadConfig(join(tmpDir, "docforce.yml"));
    assert.deepEqual(config.documentation.allowedRoots, ["docs/"]);
    assert.equal(config.documentation.aiAssisted.length, 1);
    assert.equal(config.documentation.aiAssisted[0]?.area, "reliability");
    assert.equal(config.documentation.aiAssisted[0]?.path, "docs/behavior.md");
    assert.equal(config.documentation.aiAssisted[0]?.sectionId, "reliability.behavior");
    assert.equal(config.documentation.aiAssisted[0]?.allowCreateSection, true);
    assert.equal(config.documentation.aiAssisted[0]?.allowCreateFile, false);
    assert.equal(config.ai.claude?.command, "/usr/bin/claude");
  });

  it("parses presentation-only technology and component overrides", () => {
    const yml = `
product:
  name: OverrideApp
  type: application
  description: Override fixture
documentation:
  allowedRoots:
    - "docs/"
  technologyOverrides:
    some-package:
      presentation: supporting-library
  componentOverrides:
    scripts:
      presentation: utility
`;
    writeFileSync(join(tmpDir, "docforce.yml"), yml);
    const config = loadConfig(join(tmpDir, "docforce.yml"));
    assert.equal(config.documentation.technologyOverrides?.["some-package"]?.presentation, "supporting-library");
    assert.equal(config.documentation.componentOverrides?.["scripts"]?.presentation, "utility");
    assert.equal(config.output.docs.systemOverview, "docs/generated/system-overview.mmd");
    assert.equal(config.output.docs.apiInventory, "docs/generated/api-inventory.md");
  });
});
