import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runDocumentationUpdate } from "./index.js";
import { stageArtifacts, buildArtifactUpdates } from "./staging.js";
import { validateStagedArtifacts } from "./validation.js";
import { applyArtifacts } from "./apply.js";
import { ARTIFACT_REGISTRY } from "./artifactRegistry.js";
import { generateUpdateReports } from "./reportGenerator.js";
import { analyzeChangeImpact } from "../impact/index.js";
import { scanWorkingTree } from "../impact/worktree.js";
import { loadConfig, resolveConfigPath } from "../config/index.js";
import { generateAllDocs } from "../generator/index.js";
import { computeModelFingerprint } from "../model/fingerprint.js";
import type { StagedArtifact } from "./staging.js";

interface FixtureRepo {
  readonly dir: string;
  commit(message: string): string;
  writeFile(path: string, content: string): void;
  removeFile(path: string): void;
  cleanup(): void;
}

function createFixtureRepo(): FixtureRepo {
  const dir = join(tmpdir(), `docforce-update-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });

  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@docforce.test"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "DocForce Test"', { cwd: dir, stdio: "pipe" });

  return {
    dir,
    commit(message: string): string {
      execSync("git add -A", { cwd: dir, stdio: "pipe" });
      execSync(`git commit --allow-empty -m "${message}"`, { cwd: dir, stdio: "pipe" });
      return execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf-8", stdio: "pipe" }).trim();
    },
    writeFile(path: string, content: string): void {
      const fullPath = join(dir, path);
      mkdirSync(join(fullPath, ".."), { recursive: true });
      writeFileSync(fullPath, content, "utf-8");
    },
    removeFile(path: string): void {
      const fullPath = join(dir, path);
      if (existsSync(fullPath)) unlinkSync(fullPath);
    },
    cleanup(): void {
      try {
        try { execSync("git worktree prune", { cwd: dir, stdio: "pipe" }); } catch {}
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    },
  };
}

const BASE_PACKAGE_JSON = JSON.stringify({
  name: "test-app",
  version: "1.0.0",
  type: "module",
  dependencies: {},
  devDependencies: { typescript: "^7.0.0" },
}, null, 2);

const BASE_TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: "ES2022",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    strict: true,
    outDir: "dist",
  },
  include: ["src/**/*"],
}, null, 2);

function baseDocforceYml(extras: string = ""): string {
  const componentsLine = extras.trim()
    ? `  components:\n${extras}`
    : `  components: {}`;
  return `schemaVersion: "0.7.0"

product:
  name: TestApp
  type: application
  description: Test application for DocForce update e2e tests

scanning:
  rootDir: "."
  include:
    - "src/**"
    - "package.json"
    - "tsconfig.json"
  exclude:
    - "node_modules/**"
    - "dist/**"

analysis:
  exclude:
    - "src/docforce/**"

architecture:
${componentsLine}

output:
  systemModel: ".docforce/system-model.json"
  docs:
    technicalOverview: "docs/generated/technical-overview.md"
    technologyInventory: "docs/generated/technology-inventory.md"
    architectureDiagram: "docs/generated/architecture.mmd"
    dependencyGraph: "docs/generated/dependency-graph.mmd"
    architectureEvidence: "docs/generated/architecture-evidence.md"
`;
}

function setupBaselineRepo(repo: FixtureRepo): string {
  repo.writeFile("package.json", BASE_PACKAGE_JSON);
  repo.writeFile("tsconfig.json", BASE_TSCONFIG);
  repo.writeFile("docforce.yml", baseDocforceYml());
  repo.writeFile("src/app/index.ts", 'export const label = "Submit";\nexport function main() { console.log(label); }\n');
  repo.writeFile("src/app/utils.ts", 'export function formatDate(d: Date): string { return d.toISOString(); }\n');
  return repo.commit("initial baseline");
}

function setupWithDocs(repo: FixtureRepo): string {
  setupBaselineRepo(repo);

  const configPath = resolveConfigPath(repo.dir);
  const config = loadConfig(configPath);
  const model = scanWorkingTree(repo.dir);
  generateAllDocs(repo.dir, config, model);

  return repo.commit("generate initial docs");
}

// ========== TEST SUITES ==========

describe("Update E2E: Scenario A — No change", () => {
  let repo: FixtureRepo;
  afterEach(() => { repo?.cleanup(); });

  it("produces no file modifications when nothing changed", () => {
    repo = createFixtureRepo();
    setupWithDocs(repo);

    const plan = runDocumentationUpdate({
      baseRef: "HEAD",
      headRef: "HEAD",
      repoRoot: repo.dir,
      apply: false,
    });

    assert.equal(plan.overallImpact, "none");
    assert.ok(plan.validationPassed);
    assert.ok(!plan.applied);

    const updates = plan.artifacts.filter((a) => a.status === "would-update" || a.status === "would-create");
    assert.equal(updates.length, 0, "No artifacts should need updating");
  });
});

describe("Update E2E: Scenario B — Cosmetic source change", () => {
  let repo: FixtureRepo;
  afterEach(() => { repo?.cleanup(); });

  it("produces no deterministic updates for string literal change", () => {
    repo = createFixtureRepo();
    setupWithDocs(repo);

    repo.writeFile("src/app/index.ts", 'export const label = "Continue";\nexport function main() { console.log(label); }\n');
    repo.commit("cosmetic: change button label");

    const plan = runDocumentationUpdate({
      baseRef: "HEAD~1",
      headRef: "HEAD",
      repoRoot: repo.dir,
      apply: false,
    });

    assert.equal(plan.overallImpact, "none");
    const updates = plan.artifacts.filter((a) => a.status === "would-update" || a.status === "would-create");
    assert.equal(updates.length, 0);
  });
});

describe("Update E2E: Scenario C — Behavioral change / no model delta", () => {
  let repo: FixtureRepo;
  afterEach(() => { repo?.cleanup(); });

  it("recommends manual review but no deterministic updates", () => {
    repo = createFixtureRepo();
    setupWithDocs(repo);

    repo.writeFile("src/app/utils.ts", 'export function formatDate(d: Date): string { return d.toLocaleDateString("en-US"); }\n');
    repo.commit("fix: change date format");

    const plan = runDocumentationUpdate({
      baseRef: "HEAD~1",
      headRef: "HEAD",
      repoRoot: repo.dir,
      apply: false,
    });

    assert.equal(plan.overallImpact, "none");
    assert.ok(plan.manualReviewRecommended);
    const updates = plan.artifacts.filter((a) => a.status === "would-update" || a.status === "would-create");
    assert.equal(updates.length, 0);
  });
});

describe("Update E2E: Scenario D — Internal dependency added", () => {
  let repo: FixtureRepo;
  afterEach(() => { repo?.cleanup(); });

  it("affected artifacts update when new relationship is added", () => {
    repo = createFixtureRepo();
    repo.writeFile("package.json", BASE_PACKAGE_JSON);
    repo.writeFile("tsconfig.json", BASE_TSCONFIG);
    repo.writeFile("docforce.yml", baseDocforceYml());
    repo.writeFile("src/app/index.ts", 'export function main() { console.log("app"); }\n');
    repo.writeFile("src/utils/index.ts", 'export function helper() { return 42; }\n');
    repo.commit("initial: two components");

    const configPath = resolveConfigPath(repo.dir);
    const config = loadConfig(configPath);
    const model = scanWorkingTree(repo.dir);
    generateAllDocs(repo.dir, config, model);
    repo.commit("generate docs");

    repo.writeFile("src/app/index.ts", 'import { helper } from "../utils/index.js";\nexport function main() { console.log(helper()); }\n');
    repo.commit("feat: app imports utils");

    const plan = runDocumentationUpdate({
      baseRef: "HEAD~1",
      headRef: "HEAD",
      repoRoot: repo.dir,
      apply: false,
    });

    assert.ok(plan.validationPassed);
    const affected = plan.artifacts.filter((a) => a.status === "would-update" || a.status === "would-create");
    assert.ok(affected.length > 0, "At least one artifact should be affected");
  });
});

describe("Update E2E: Scenario E — New technology", () => {
  let repo: FixtureRepo;
  afterEach(() => { repo?.cleanup(); });

  it("inventory and overview update when dependency is added", () => {
    repo = createFixtureRepo();
    setupWithDocs(repo);

    const pkg = JSON.parse(BASE_PACKAGE_JSON);
    pkg.dependencies.redis = "^5.0.0";
    repo.writeFile("package.json", JSON.stringify(pkg, null, 2));
    repo.writeFile("src/cache/index.ts", 'import { createClient } from "redis";\nexport const client = createClient();\n');
    repo.commit("feat: add Redis cache");

    const plan = runDocumentationUpdate({
      baseRef: "HEAD~1",
      headRef: "HEAD",
      repoRoot: repo.dir,
      apply: false,
    });

    assert.ok(plan.validationPassed);

    const overview = plan.artifacts.find((a) => a.artifact === "technical-overview.md");
    const inventory = plan.artifacts.find((a) => a.artifact === "technology-inventory.md");
    assert.ok(
      overview?.status === "would-update" || overview?.status === "would-create",
      `Overview should update, got ${overview?.status}`,
    );
    assert.ok(
      inventory?.status === "would-update" || inventory?.status === "would-create",
      `Inventory should update, got ${inventory?.status}`,
    );
  });
});

describe("Update E2E: Scenario F — Component addition", () => {
  let repo: FixtureRepo;
  afterEach(() => { repo?.cleanup(); });

  it("architecture docs update when component is added", () => {
    repo = createFixtureRepo();
    setupWithDocs(repo);

    repo.writeFile("src/queue/index.ts", 'export function enqueue(item: string) { return item; }\n');
    repo.writeFile("src/app/index.ts", 'import { enqueue } from "../queue/index.js";\nexport const label = "Submit";\nexport function main() { enqueue(label); }\n');
    repo.commit("feat: add queue component");

    const plan = runDocumentationUpdate({
      baseRef: "HEAD~1",
      headRef: "HEAD",
      repoRoot: repo.dir,
      apply: false,
    });

    assert.ok(plan.validationPassed);
    const affected = plan.artifacts.filter((a) => a.status === "would-update" || a.status === "would-create");
    assert.ok(affected.length > 0, "At least one artifact should need updating after component addition");
  });
});

describe("Update E2E: Scenario G — Presentation-only change", () => {
  let repo: FixtureRepo;
  afterEach(() => { repo?.cleanup(); });

  it("architecture.mmd is considered affected for presentation change", () => {
    repo = createFixtureRepo();
    repo.writeFile("package.json", BASE_PACKAGE_JSON);
    repo.writeFile("tsconfig.json", BASE_TSCONFIG);
    repo.writeFile("docforce.yml", baseDocforceYml(`
    app:
      displayName: Application
      includeInOverview: true
`));
    repo.writeFile("src/app/index.ts", 'export function main() { console.log("app"); }\n');
    repo.commit("initial");

    const configPath = resolveConfigPath(repo.dir);
    const config = loadConfig(configPath);
    const model = scanWorkingTree(repo.dir);
    generateAllDocs(repo.dir, config, model);
    repo.commit("generate docs");

    repo.writeFile("docforce.yml", baseDocforceYml(`
    app:
      displayName: Main Application
      includeInOverview: false
`));
    repo.commit("config: change display name and overview");

    const plan = runDocumentationUpdate({
      baseRef: "HEAD~1",
      headRef: "HEAD",
      repoRoot: repo.dir,
      apply: false,
    });

    const arch = plan.artifacts.find((a) => a.artifact === "architecture.mmd");
    assert.ok(arch, "architecture.mmd should be in the plan");
  });
});

describe("Update E2E: Scenario H — Affected but regenerates identically", () => {
  let repo: FixtureRepo;
  afterEach(() => { repo?.cleanup(); });

  it("marks as unchanged when regenerated content matches existing", () => {
    repo = createFixtureRepo();
    setupWithDocs(repo);

    const pkg = JSON.parse(BASE_PACKAGE_JSON);
    pkg.dependencies.redis = "^5.0.0";
    repo.writeFile("package.json", JSON.stringify(pkg, null, 2));
    repo.writeFile("src/cache/index.ts", 'import { createClient } from "redis";\nexport const client = createClient();\n');
    repo.commit("feat: add Redis");

    const plan1 = runDocumentationUpdate({
      baseRef: "HEAD~1",
      headRef: "HEAD",
      repoRoot: repo.dir,
      apply: true,
    });

    if (plan1.applied) {
      repo.commit("docs: update generated docs");
    }

    const plan2 = runDocumentationUpdate({
      baseRef: "HEAD~1",
      headRef: "HEAD",
      repoRoot: repo.dir,
      apply: false,
    });

    const wouldUpdate = plan2.artifacts.filter((a) => a.status === "would-update");
    assert.equal(wouldUpdate.length, 0, "After applying, second run should show no would-update artifacts");
  });
});

describe("Update E2E: Scenario I — Missing affected artifact", () => {
  let repo: FixtureRepo;
  afterEach(() => { repo?.cleanup(); });

  it("would-create status when artifact file does not exist", () => {
    repo = createFixtureRepo();
    setupBaselineRepo(repo);

    const pkg = JSON.parse(BASE_PACKAGE_JSON);
    pkg.dependencies.redis = "^5.0.0";
    repo.writeFile("package.json", JSON.stringify(pkg, null, 2));
    repo.writeFile("src/cache/index.ts", 'import { createClient } from "redis";\nexport const client = createClient();\n');
    repo.commit("feat: add Redis");

    const plan = runDocumentationUpdate({
      baseRef: "HEAD~1",
      headRef: "HEAD",
      repoRoot: repo.dir,
      apply: true,
    });

    assert.ok(plan.validationPassed);
    const creates = plan.artifacts.filter((a) => a.status === "would-create");
    assert.ok(creates.length > 0, "Missing artifacts should be marked would-create");
    assert.ok(plan.applied, "Apply should succeed");

    for (const c of creates) {
      assert.ok(existsSync(join(repo.dir, c.path)), `${c.path} should be created on disk`);
    }
  });
});

describe("Update E2E: Scenario J — Idempotency", () => {
  let repo: FixtureRepo;
  afterEach(() => { repo?.cleanup(); });

  it("update --apply then update again = all unchanged", () => {
    repo = createFixtureRepo();
    setupWithDocs(repo);

    const pkg = JSON.parse(BASE_PACKAGE_JSON);
    pkg.dependencies.redis = "^5.0.0";
    repo.writeFile("package.json", JSON.stringify(pkg, null, 2));
    repo.writeFile("src/cache/index.ts", 'import { createClient } from "redis";\nexport const client = createClient();\n');
    repo.commit("feat: add Redis");

    const plan1 = runDocumentationUpdate({
      baseRef: "HEAD~1",
      headRef: "HEAD",
      repoRoot: repo.dir,
      apply: true,
    });
    assert.ok(plan1.validationPassed);

    const plan2 = runDocumentationUpdate({
      baseRef: "HEAD~1",
      headRef: "HEAD",
      repoRoot: repo.dir,
      apply: false,
    });

    const wouldUpdate = plan2.artifacts.filter((a) => a.status === "would-update");
    assert.equal(wouldUpdate.length, 0, "Idempotent: second run should show no would-update");
  });
});

describe("Update E2E: Scenario K — Self-trigger prevention", () => {
  let repo: FixtureRepo;
  afterEach(() => { repo?.cleanup(); });

  it("after apply, second run shows no self-triggered impact", () => {
    repo = createFixtureRepo();
    setupWithDocs(repo);

    repo.writeFile("src/queue/index.ts", 'export function enqueue(item: string) { return item; }\n');
    repo.commit("feat: add queue");

    const plan1 = runDocumentationUpdate({
      baseRef: "HEAD~1",
      headRef: "HEAD",
      repoRoot: repo.dir,
      apply: true,
    });

    if (plan1.applied) {
      repo.commit("docs: update after queue addition");
    }

    const plan2 = runDocumentationUpdate({
      baseRef: "HEAD~1",
      headRef: "HEAD",
      repoRoot: repo.dir,
      apply: false,
    });

    const selfTriggered = plan2.artifacts.filter(
      (a) => a.status === "would-update" && a.reason.includes("self-trigger"),
    );
    assert.equal(selfTriggered.length, 0, "No artifacts should be self-triggered");
  });
});

describe("Update E2E: Validation failure", () => {
  it("path traversal rejected by validation", () => {
    const staged: StagedArtifact[] = [
      {
        artifact: "technical-overview.md",
        path: "../../etc/passwd",
        content: "# Malicious\n",
        newHash: "abc123",
        status: "would-create",
        impact: undefined,
      },
    ];

    const result = validateStagedArtifacts(staged, "/tmp/test-repo");
    assert.ok(!result.valid, "Path traversal should be rejected");
    assert.ok(result.errors.some((e) => e.includes("outside repository root")));
  });
});

describe("Update E2E: Apply rollback", () => {
  let repo: FixtureRepo;
  afterEach(() => { repo?.cleanup(); });

  it("empty input produces no writes", () => {
    repo = createFixtureRepo();
    setupBaselineRepo(repo);

    const result = applyArtifacts([], repo.dir);
    assert.equal(result.applied.length, 0);
    assert.equal(result.created.length, 0);
    assert.ok(!result.rolledBack);
  });

  it("successfully applies valid staged artifacts", () => {
    repo = createFixtureRepo();
    setupBaselineRepo(repo);

    const staged: StagedArtifact[] = [
      {
        artifact: "technical-overview.md",
        path: "docs/generated/technical-overview.md",
        content: "# Test Overview\n\nGenerated content.\n",
        newHash: "abc123",
        status: "would-create",
        impact: undefined,
      },
    ];

    const result = applyArtifacts(staged, repo.dir);
    assert.ok(!result.rolledBack);
    assert.equal(result.applied.length, 1);
    assert.equal(result.created.length, 1);
    assert.ok(existsSync(join(repo.dir, "docs/generated/technical-overview.md")));
  });
});

describe("Update E2E: Report generation", () => {
  let repo: FixtureRepo;
  afterEach(() => { repo?.cleanup(); });

  it("generates JSON and markdown reports", () => {
    repo = createFixtureRepo();
    setupWithDocs(repo);

    const plan = runDocumentationUpdate({
      baseRef: "HEAD",
      headRef: "HEAD",
      repoRoot: repo.dir,
      apply: false,
    });

    const { jsonPath, mdPath } = generateUpdateReports(plan, repo.dir);

    assert.ok(existsSync(jsonPath), "JSON report should exist");
    assert.ok(existsSync(mdPath), "Markdown report should exist");

    const json = JSON.parse(readFileSync(jsonPath, "utf-8"));
    assert.equal(json.overallImpact, "none");

    const md = readFileSync(mdPath, "utf-8");
    assert.ok(md.includes("# DocForce Documentation Update Plan"));
    assert.ok(md.includes("Generated by DocForce"));
  });
});

describe("Update E2E: Deterministic output", () => {
  let repo: FixtureRepo;
  afterEach(() => { repo?.cleanup(); });

  it("generated docs do not contain volatile metadata", () => {
    repo = createFixtureRepo();
    const sha = setupBaselineRepo(repo);

    const configPath = resolveConfigPath(repo.dir);
    const config = loadConfig(configPath);
    const model = scanWorkingTree(repo.dir);
    generateAllDocs(repo.dir, config, model);

    const overview = readFileSync(join(repo.dir, "docs/generated/technical-overview.md"), "utf-8");
    const inventory = readFileSync(join(repo.dir, "docs/generated/technology-inventory.md"), "utf-8");
    const evidence = readFileSync(join(repo.dir, "docs/generated/architecture-evidence.md"), "utf-8");
    const diagram = readFileSync(join(repo.dir, "docs/generated/architecture.mmd"), "utf-8");

    for (const [name, content] of [["overview", overview], ["inventory", inventory], ["evidence", evidence], ["diagram", diagram]] as const) {
      assert.ok(!content.includes("v0."), `${name} should not contain version number`);
      assert.ok(!content.match(/\d{4}-\d{2}-\d{2}/), `${name} should not contain date stamps`);
      assert.ok(!content.includes("[uncommitted changes]"), `${name} should not contain dirty flag`);
      assert.ok(!content.includes(sha), `${name} should not contain commit SHA`);
    }

    assert.ok(overview.includes("Generated by DocForce"), "Overview should have stable provenance");
    assert.ok(!overview.includes("Commit:"), "Overview should not contain commit line");
    assert.ok(!overview.includes("Repository:"), "Overview should not contain repository line");
    assert.ok(inventory.includes("Generated by DocForce"), "Inventory should have stable provenance");
    assert.ok(evidence.includes("Generated by DocForce"), "Evidence should have stable provenance");
    assert.ok(diagram.includes("Generated by DocForce"), "Diagram should have stable provenance");
  });
});

describe("Update E2E: Model fingerprint stability", () => {
  let repo: FixtureRepo;
  afterEach(() => { repo?.cleanup(); });

  it("fingerprint unchanged across Git-only changes", () => {
    repo = createFixtureRepo();
    setupBaselineRepo(repo);

    const model1 = scanWorkingTree(repo.dir);
    const fp1 = computeModelFingerprint(model1);

    repo.writeFile("README.md", "# Updated readme\n");
    repo.commit("docs: update readme");

    const model2 = scanWorkingTree(repo.dir);
    const fp2 = computeModelFingerprint(model2);

    assert.equal(fp1, fp2, "Fingerprint should not change when only Git metadata changes");
  });

  it("fingerprint changes when product model changes", () => {
    repo = createFixtureRepo();
    setupBaselineRepo(repo);

    const model1 = scanWorkingTree(repo.dir);
    const fp1 = computeModelFingerprint(model1);

    const pkg = JSON.parse(BASE_PACKAGE_JSON);
    pkg.dependencies = { redis: "^5.0.0" };
    repo.writeFile("package.json", JSON.stringify(pkg, null, 2));
    repo.writeFile("src/cache/index.ts", 'import { createClient } from "redis";\nexport const client = createClient();\n');
    repo.commit("feat: add Redis");

    const model2 = scanWorkingTree(repo.dir);
    const fp2 = computeModelFingerprint(model2);

    assert.notEqual(fp1, fp2, "Fingerprint should change when a new technology is added");
  });

  it("fingerprint changes when component is added", () => {
    repo = createFixtureRepo();
    setupBaselineRepo(repo);

    const model1 = scanWorkingTree(repo.dir);
    const fp1 = computeModelFingerprint(model1);

    repo.writeFile("src/queue/index.ts", 'export function enqueue(item: string) { return item; }\n');
    repo.commit("feat: add queue component");

    const model2 = scanWorkingTree(repo.dir);
    const fp2 = computeModelFingerprint(model2);

    assert.notEqual(fp1, fp2, "Fingerprint should change when a component is added");
  });

  it("fingerprint unchanged for pure generated-doc commit", () => {
    repo = createFixtureRepo();
    setupWithDocs(repo);

    const model1 = scanWorkingTree(repo.dir);
    const fp1 = computeModelFingerprint(model1);

    repo.writeFile("docs/generated/technical-overview.md", "# Changed doc\n> Generated by DocForce\n");
    repo.commit("docs: regenerate");

    const model2 = scanWorkingTree(repo.dir);
    const fp2 = computeModelFingerprint(model2);

    assert.equal(fp1, fp2, "Fingerprint should not change from generated doc changes alone");
  });
});

describe("Update E2E: Post-commit idempotency", () => {
  let repo: FixtureRepo;
  afterEach(() => { repo?.cleanup(); });

  it("no documentation churn after committing applied updates", () => {
    repo = createFixtureRepo();
    setupWithDocs(repo);
    const baseCommit = repo.commit("baseline with docs");

    repo.writeFile("src/queue/index.ts", 'export function enqueue(item: string) { return item; }\n');
    repo.writeFile("src/app/index.ts", 'import { enqueue } from "../queue/index.js";\nexport const label = "Submit";\nexport function main() { enqueue(label); }\n');
    const changeCommit = repo.commit("feat: add queue component");

    const plan1 = runDocumentationUpdate({
      baseRef: baseCommit,
      headRef: changeCommit,
      repoRoot: repo.dir,
      apply: true,
    });

    assert.ok(plan1.validationPassed, "First update should pass validation");
    const updatedArtifacts = plan1.artifacts.filter((a) => a.status === "would-update" || a.status === "would-create");
    assert.ok(updatedArtifacts.length > 0, "First update should produce changes");

    const postUpdateCommit = repo.commit("docs: apply DocForce update");

    const plan2 = runDocumentationUpdate({
      baseRef: changeCommit,
      headRef: postUpdateCommit,
      repoRoot: repo.dir,
      apply: false,
    });

    const wouldUpdate = plan2.artifacts.filter((a) => a.status === "would-update");
    assert.equal(wouldUpdate.length, 0,
      "After committing applied updates, no documentation should need further updating — " +
      "the new commit SHA must not cause doc churn");

    const wouldCreate = plan2.artifacts.filter((a) => a.status === "would-create");
    assert.equal(wouldCreate.length, 0, "No new artifacts should be needed");
  });
});

describe("Update E2E: Report retains operational provenance", () => {
  let repo: FixtureRepo;
  afterEach(() => { repo?.cleanup(); });

  it("update reports contain Git refs, version, and timestamp", () => {
    repo = createFixtureRepo();
    setupWithDocs(repo);

    const plan = runDocumentationUpdate({
      baseRef: "HEAD",
      headRef: "HEAD",
      repoRoot: repo.dir,
      apply: false,
    });

    const { jsonPath, mdPath } = generateUpdateReports(plan, repo.dir);

    const json = JSON.parse(readFileSync(jsonPath, "utf-8"));
    assert.ok(json.generatedAt, "Report should contain generation timestamp");
    assert.ok(json.docforceVersion, "Report should contain DocForce version");
    assert.ok(json.baseRef, "Report should contain base ref");
    assert.ok(json.headRef, "Report should contain head ref");

    const md = readFileSync(mdPath, "utf-8");
    assert.ok(md.includes("Generated by DocForce v"), "Markdown report should include version");
    assert.ok(md.includes("Base:"), "Markdown report should include base ref");
    assert.ok(md.includes("Head:"), "Markdown report should include head ref");
  });
});
