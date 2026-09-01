import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { mkdirSync, writeFileSync, rmSync, existsSync, unlinkSync, renameSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyzeChangeImpact } from "./index.js";
import { scanAtRef, scanWorkingTree } from "./worktree.js";
import { compareModels } from "./modelDiff.js";
import { classifyFile, classifyFileChanges, getProductRelevantChanges } from "./fileClassifier.js";
import { validateImpactReport } from "./validation.js";
import type { FileChange } from "./types.js";

// ========== FIXTURE HARNESS ==========

interface FixtureRepo {
  readonly dir: string;
  commit(message: string): string;
  writeFile(path: string, content: string): void;
  removeFile(path: string): void;
  renameFile(oldPath: string, newPath: string): void;
  cleanup(): void;
}

function createFixtureRepo(): FixtureRepo {
  const dir = join(tmpdir(), `docforce-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
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
    renameFile(oldPath: string, newPath: string): void {
      const oldFull = join(dir, oldPath);
      const newFull = join(dir, newPath);
      mkdirSync(join(newFull, ".."), { recursive: true });
      renameSync(oldFull, newFull);
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
  description: Test application for DocForce e2e tests

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

// ========== TEST SUITES ==========

describe("E2E: Fixture Harness", () => {
  let repo: FixtureRepo;
  
  afterEach(() => { repo?.cleanup(); });

  it("creates a scannable fixture repo", () => {
    repo = createFixtureRepo();
    setupBaselineRepo(repo);
    const model = scanWorkingTree(repo.dir);
    assert.ok(model.components.length >= 1, "Should discover at least 1 component");
    assert.equal(model.product.name, "TestApp");
  });
});

describe("E2E Scenario A — Cosmetic source change", () => {
  let repo: FixtureRepo;
  
  afterEach(() => { repo?.cleanup(); });

  it("produces no model delta for a string literal change", () => {
    repo = createFixtureRepo();
    setupBaselineRepo(repo);
    
    repo.writeFile("src/app/index.ts", 'export const label = "Continue";\nexport function main() { console.log(label); }\n');
    repo.commit("cosmetic: change button label");
    
    const report = analyzeChangeImpact({ baseRef: "HEAD~1", headRef: "HEAD", repoRoot: repo.dir });
    
    assert.ok(report.fileChanges.length > 0, "Should detect file change");
    assert.ok(report.modelDelta.isEmpty, "Model delta should be empty for cosmetic change");
    assert.equal(report.overallImpactLevel, "none");
    
    const validation = validateImpactReport(report);
    assert.ok(validation.valid, `Validation errors: ${validation.errors.join(", ")}`);
  });
});

describe("E2E Scenario B — New dependency", () => {
  let repo: FixtureRepo;
  
  afterEach(() => { repo?.cleanup(); });

  it("detects new technology from added dependency", () => {
    repo = createFixtureRepo();
    setupBaselineRepo(repo);
    
    const pkg = JSON.parse(BASE_PACKAGE_JSON);
    pkg.dependencies.redis = "^5.0.0";
    repo.writeFile("package.json", JSON.stringify(pkg, null, 2));
    repo.writeFile("src/cache/index.ts", 'import { createClient } from "redis";\nexport const client = createClient();\n');
    repo.commit("feat: add Redis cache");
    
    const report = analyzeChangeImpact({ baseRef: "HEAD~1", headRef: "HEAD", repoRoot: repo.dir });
    
    assert.ok(!report.modelDelta.isEmpty, "Model delta should not be empty");
    const hasTechOrCompChange = report.modelDelta.entityChanges.some((e) =>
      e.domain === "technologies" || e.domain === "components",
    );
    assert.ok(hasTechOrCompChange, "Should detect technology or component change");
    assert.ok(report.overallImpactLevel === "high" || report.overallImpactLevel === "medium",
      `Impact should be high or medium, got ${report.overallImpactLevel}`);
    
    const validation = validateImpactReport(report);
    assert.ok(validation.valid, `Validation errors: ${validation.errors.join(", ")}`);
  });
});

describe("E2E Scenario C — Internal import added", () => {
  let repo: FixtureRepo;
  
  afterEach(() => { repo?.cleanup(); });

  it("detects new relationship when component imports another", () => {
    repo = createFixtureRepo();
    repo.writeFile("package.json", BASE_PACKAGE_JSON);
    repo.writeFile("tsconfig.json", BASE_TSCONFIG);
    repo.writeFile("docforce.yml", baseDocforceYml());
    repo.writeFile("src/app/index.ts", 'export function main() { console.log("app"); }\n');
    repo.writeFile("src/utils/index.ts", 'export function helper() { return 42; }\n');
    repo.commit("initial: two components");
    
    repo.writeFile("src/app/index.ts", 'import { helper } from "../utils/index.js";\nexport function main() { console.log(helper()); }\n');
    repo.commit("feat: app imports utils");
    
    const report = analyzeChangeImpact({ baseRef: "HEAD~1", headRef: "HEAD", repoRoot: repo.dir });
    
    const relAdded = report.modelDelta.relationshipChanges.some((r) => r.changeType === "added");
    assert.ok(relAdded, "Should detect added relationship");
    assert.ok(report.modelDelta.changedDomains.has("relationships"));
    
    const depGraph = report.documentImpacts.find((d) => d.artifact === "dependency-graph.mmd");
    const evidence = report.documentImpacts.find((d) => d.artifact === "architecture-evidence.md");
    assert.ok(depGraph?.affected, "dependency-graph.mmd should be affected");
    assert.ok(evidence?.affected, "architecture-evidence.md should be affected");
    
    const validation = validateImpactReport(report);
    assert.ok(validation.valid, `Validation errors: ${validation.errors.join(", ")}`);
  });
});

describe("E2E Scenario D — Datastore replacement", () => {
  let repo: FixtureRepo;
  
  afterEach(() => { repo?.cleanup(); });

  it("detects ARCHITECTURAL impact for datastore swap", () => {
    repo = createFixtureRepo();
    repo.writeFile("package.json", BASE_PACKAGE_JSON);
    repo.writeFile("tsconfig.json", BASE_TSCONFIG);
    repo.writeFile("docforce.yml", baseDocforceYml());
    repo.writeFile("src/db/index.ts", 'import sqlite from "node:sqlite";\nexport const db = new sqlite.DatabaseSync(":memory:");\n');
    repo.commit("initial: sqlite db");
    
    repo.writeFile("src/db/index.ts", 'import pg from "pg";\nexport const pool = new pg.Pool();\n');
    const pkgPg = JSON.parse(BASE_PACKAGE_JSON);
    pkgPg.dependencies.pg = "^8.0.0";
    repo.writeFile("package.json", JSON.stringify(pkgPg, null, 2));
    repo.commit("feat: replace sqlite with postgres");
    
    const report = analyzeChangeImpact({ baseRef: "HEAD~1", headRef: "HEAD", repoRoot: repo.dir });
    
    assert.ok(!report.modelDelta.isEmpty, "Should have model changes");
    const hasDatastoreOrTech = report.modelDelta.entityChanges.some((e) =>
      e.domain === "datastores" || e.domain === "technologies",
    );
    assert.ok(hasDatastoreOrTech, "Should detect datastore or technology change");
    
    const validation = validateImpactReport(report);
    assert.ok(validation.valid, `Validation errors: ${validation.errors.join(", ")}`);
  });
});

describe("E2E Scenario E — Component added", () => {
  let repo: FixtureRepo;
  
  afterEach(() => { repo?.cleanup(); });

  it("detects new component with HIGH impact", () => {
    repo = createFixtureRepo();
    setupBaselineRepo(repo);
    
    repo.writeFile("src/queue/index.ts", 'export function enqueue(item: string) { return item; }\n');
    repo.writeFile("src/app/index.ts", 'import { enqueue } from "../queue/index.js";\nexport const label = "Submit";\nexport function main() { enqueue(label); }\n');
    repo.commit("feat: add queue component");
    
    const report = analyzeChangeImpact({ baseRef: "HEAD~1", headRef: "HEAD", repoRoot: repo.dir });
    
    const compAdded = report.modelDelta.entityChanges.find((e) =>
      e.domain === "components" && e.changeType === "added" && e.name === "queue",
    );
    assert.ok(compAdded, "Should detect queue component added");
    assert.equal(report.overallImpactLevel, "high");
    
    const validation = validateImpactReport(report);
    assert.ok(validation.valid, `Validation errors: ${validation.errors.join(", ")}`);
  });
});

describe("E2E Scenario F — Component removed", () => {
  let repo: FixtureRepo;
  
  afterEach(() => { repo?.cleanup(); });

  it("detects component removal", () => {
    repo = createFixtureRepo();
    repo.writeFile("package.json", BASE_PACKAGE_JSON);
    repo.writeFile("tsconfig.json", BASE_TSCONFIG);
    repo.writeFile("docforce.yml", baseDocforceYml());
    repo.writeFile("src/app/index.ts", 'export function main() { console.log("app"); }\n');
    repo.writeFile("src/legacy/index.ts", 'export function old() { return "legacy"; }\n');
    repo.commit("initial: app + legacy");
    
    repo.removeFile("src/legacy/index.ts");
    try { execSync(`rm -rf "${join(repo.dir, "src/legacy")}"`, { stdio: "pipe" }); } catch {}
    repo.commit("remove: legacy component");
    
    const report = analyzeChangeImpact({ baseRef: "HEAD~1", headRef: "HEAD", repoRoot: repo.dir });
    
    const compRemoved = report.modelDelta.entityChanges.find((e) =>
      e.domain === "components" && e.changeType === "removed" && e.name === "legacy",
    );
    assert.ok(compRemoved, "Should detect legacy component removed");
    
    const validation = validateImpactReport(report);
    assert.ok(validation.valid, `Validation errors: ${validation.errors.join(", ")}`);
  });
});

describe("E2E Scenario G — Architecture presentation change", () => {
  let repo: FixtureRepo;
  
  afterEach(() => { repo?.cleanup(); });

  it("detects presentation-only change without component technical delta", () => {
    repo = createFixtureRepo();
    repo.writeFile("package.json", BASE_PACKAGE_JSON);
    repo.writeFile("tsconfig.json", BASE_TSCONFIG);
    repo.writeFile("docforce.yml", baseDocforceYml(`
    app:
      displayName: Application
      includeInOverview: true
`));
    repo.writeFile("src/app/index.ts", 'export function main() { console.log("app"); }\n');
    repo.commit("initial: app with display name");
    
    repo.writeFile("docforce.yml", baseDocforceYml(`
    app:
      displayName: Main Application
      includeInOverview: false
`));
    repo.commit("config: change display name and overview");
    
    const report = analyzeChangeImpact({ baseRef: "HEAD~1", headRef: "HEAD", repoRoot: repo.dir });
    
    const hasPresentationChange = report.modelDelta.changedDomains.has("architecture-presentation");
    const hasComponentChange = report.modelDelta.entityChanges.some((e) =>
      e.domain === "components" && e.changeType !== "added" && e.changeType !== "removed",
    );
    
    assert.ok(hasPresentationChange || report.modelDelta.entityChanges.some((e) =>
      e.domain === "architecture-presentation"),
      "Should detect architecture-presentation change");
    
    const archAffected = report.documentImpacts.find((d) => d.artifact === "architecture.mmd");
    assert.ok(archAffected?.affected, "architecture.mmd should be affected");
    
    if (!report.modelDelta.entityChanges.some((e) => 
      e.domain !== "architecture-presentation" && e.domain !== "product")) {
      assert.equal(report.overallImpactLevel, "low",
        `Expected low impact for presentation-only change, got ${report.overallImpactLevel}`);
    }
    
    const validation = validateImpactReport(report);
    assert.ok(validation.valid, `Validation errors: ${validation.errors.join(", ")}`);
  });
});

describe("E2E Scenario H — File rename", () => {
  let repo: FixtureRepo;
  
  afterEach(() => { repo?.cleanup(); });

  it("detects rename without architecture delta", () => {
    repo = createFixtureRepo();
    setupBaselineRepo(repo);
    
    repo.renameFile("src/app/utils.ts", "src/app/helpers.ts");
    repo.commit("refactor: rename utils to helpers");
    
    const report = analyzeChangeImpact({ baseRef: "HEAD~1", headRef: "HEAD", repoRoot: repo.dir });
    
    assert.ok(report.fileChanges.length > 0, "Should detect file changes");
    assert.ok(report.modelDelta.isEmpty, "Model delta should be empty for internal rename");
    assert.equal(report.overallImpactLevel, "none");
    
    const validation = validateImpactReport(report);
    assert.ok(validation.valid, `Validation errors: ${validation.errors.join(", ")}`);
  });
});

describe("E2E Scenario I — Behavioral change with no architecture delta", () => {
  let repo: FixtureRepo;
  
  afterEach(() => { repo?.cleanup(); });

  it("recommends manual review for function body change", () => {
    repo = createFixtureRepo();
    setupBaselineRepo(repo);
    
    repo.writeFile("src/app/utils.ts", 'export function formatDate(d: Date): string { return d.toLocaleDateString("en-US"); }\n');
    repo.commit("fix: change date format");
    
    const report = analyzeChangeImpact({ baseRef: "HEAD~1", headRef: "HEAD", repoRoot: repo.dir });
    
    assert.ok(report.modelDelta.isEmpty, "Model delta should be empty");
    assert.equal(report.overallImpactLevel, "none");
    assert.ok(report.manualReviewRecommended, "Manual review should be recommended");
    assert.ok(report.manualReviewReason, "Should have a reason");
    assert.ok(report.manualReviewReason!.includes("deterministic") || 
              report.manualReviewReason!.includes("static-analysis"),
              "Reason should mention analysis limitations");
    
    const validation = validateImpactReport(report);
    assert.ok(validation.valid, `Validation errors: ${validation.errors.join(", ")}`);
  });
});

describe("E2E Scenario J — No change", () => {
  let repo: FixtureRepo;
  
  afterEach(() => { repo?.cleanup(); });

  it("produces clean no-impact report", () => {
    repo = createFixtureRepo();
    setupBaselineRepo(repo);
    
    const report = analyzeChangeImpact({ baseRef: "HEAD", headRef: "HEAD", repoRoot: repo.dir });
    
    assert.equal(report.fileChanges.length, 0);
    assert.ok(report.modelDelta.isEmpty);
    assert.equal(report.overallImpactLevel, "none");
    assert.ok(!report.manualReviewRecommended);
    
    const validation = validateImpactReport(report);
    assert.ok(validation.valid, `Validation errors: ${validation.errors.join(", ")}`);
  });
});

describe("E2E: Self-trigger prevention", () => {
  let repo: FixtureRepo;
  
  afterEach(() => { repo?.cleanup(); });

  it("generated-doc-only changes do not trigger manual review", () => {
    repo = createFixtureRepo();
    setupBaselineRepo(repo);
    
    repo.writeFile("docs/generated/technical-overview.md", "# Updated overview\n");
    repo.commit("docs: regenerate overview");
    
    const report = analyzeChangeImpact({ baseRef: "HEAD~1", headRef: "HEAD", repoRoot: repo.dir });
    
    assert.ok(report.modelDelta.isEmpty);
    assert.equal(report.overallImpactLevel, "none");
    assert.ok(!report.manualReviewRecommended, "Generated doc changes should NOT trigger manual review");
    
    const validation = validateImpactReport(report);
    assert.ok(validation.valid, `Validation errors: ${validation.errors.join(", ")}`);
  });

  it("docforce-internal-only changes do not trigger manual review", () => {
    repo = createFixtureRepo();
    setupBaselineRepo(repo);
    
    repo.writeFile("src/docforce/scanner/newScanner.ts", 'export function scan() { return []; }\n');
    repo.commit("feat: new docforce scanner");
    
    const report = analyzeChangeImpact({ baseRef: "HEAD~1", headRef: "HEAD", repoRoot: repo.dir });
    
    assert.ok(report.modelDelta.isEmpty);
    assert.ok(!report.manualReviewRecommended, "DocForce internal changes should NOT trigger manual review");
  });

  it("test-only changes do not trigger manual review", () => {
    repo = createFixtureRepo();
    setupBaselineRepo(repo);
    
    repo.writeFile("src/app/index.test.ts", 'import { describe, it } from "node:test";\ndescribe("app", () => { it("works", () => {}); });\n');
    repo.commit("test: add app tests");
    
    const report = analyzeChangeImpact({ baseRef: "HEAD~1", headRef: "HEAD", repoRoot: repo.dir });
    
    assert.ok(!report.manualReviewRecommended, "Test-only changes should NOT trigger manual review");
  });
});

describe("E2E: File classifier", () => {
  it("classifies file paths correctly", () => {
    assert.equal(classifyFile("src/app/index.ts"), "source");
    assert.equal(classifyFile("src/app/index.test.ts"), "test");
    assert.equal(classifyFile("src/docforce/scanner/foo.ts"), "docforce-internal");
    assert.equal(classifyFile("docs/generated/overview.md"), "generated-documentation");
    assert.equal(classifyFile(".docforce/system-model.json"), "generated-documentation");
    assert.equal(classifyFile("docforce.yml"), "configuration");
    assert.equal(classifyFile("package.json"), "configuration");
    assert.equal(classifyFile("Dockerfile"), "infrastructure");
    assert.equal(classifyFile(".github/workflows/ci.yml"), "infrastructure");
    assert.equal(classifyFile("docs/README.md"), "documentation");
    assert.equal(classifyFile("random.bin"), "unknown");
  });

  it("filters product-relevant changes", () => {
    const changes: FileChange[] = [
      { path: "src/app/main.ts", changeType: "modified" },
      { path: "docs/generated/overview.md", changeType: "modified" },
      { path: "src/docforce/cli.ts", changeType: "modified" },
      { path: "src/app/test.test.ts", changeType: "added" },
    ];
    const classified = classifyFileChanges(changes);
    const relevant = getProductRelevantChanges(classified);
    
    assert.equal(relevant.length, 2, "Should exclude generated-doc and docforce-internal");
    assert.ok(relevant.some((f) => f.path === "src/app/main.ts"));
    assert.ok(relevant.some((f) => f.path === "src/app/test.test.ts"));
  });
});

describe("E2E: Worktree safety", () => {
  let repo: FixtureRepo;
  
  afterEach(() => { repo?.cleanup(); });

  it("does not modify caller working tree", () => {
    repo = createFixtureRepo();
    setupBaselineRepo(repo);
    
    const beforeStatus = execSync("git status --porcelain", { cwd: repo.dir, encoding: "utf-8" }).trim();
    
    const model = scanAtRef(repo.dir, "HEAD");
    assert.ok(model);
    
    const afterStatus = execSync("git status --porcelain", { cwd: repo.dir, encoding: "utf-8" }).trim();
    assert.equal(afterStatus, beforeStatus, "Working tree should be unchanged after scanAtRef");
  });

  it("cleans up after successful analysis", () => {
    repo = createFixtureRepo();
    setupBaselineRepo(repo);
    
    scanAtRef(repo.dir, "HEAD");
    
    const worktrees = execSync("git worktree list", { cwd: repo.dir, encoding: "utf-8" }).trim();
    const lines = worktrees.split("\n");
    assert.equal(lines.length, 1, "Should only have the main worktree");
  });

  it("throws on invalid ref", () => {
    repo = createFixtureRepo();
    setupBaselineRepo(repo);
    
    assert.throws(() => {
      scanAtRef(repo.dir, "nonexistent-ref-abc123");
    }, /Invalid Git ref/);
  });

  it("cleans up after scanner failure", () => {
    repo = createFixtureRepo();
    repo.writeFile("package.json", BASE_PACKAGE_JSON);
    repo.commit("minimal commit");
    
    try {
      scanAtRef(repo.dir, "HEAD");
    } catch {
      // Expected — no docforce.yml
    }
    
    const worktrees = execSync("git worktree list", { cwd: repo.dir, encoding: "utf-8" }).trim();
    const lines = worktrees.split("\n");
    assert.equal(lines.length, 1, "Should only have the main worktree after failure");
  });
});

describe("E2E: Deterministic model comparison", () => {
  let repo: FixtureRepo;
  
  afterEach(() => { repo?.cleanup(); });

  it("two scans of same repo produce empty delta", () => {
    repo = createFixtureRepo();
    setupBaselineRepo(repo);
    
    const model1 = scanWorkingTree(repo.dir);
    const model2 = scanWorkingTree(repo.dir);
    
    const delta = compareModels(model1, model2);
    assert.ok(delta.isEmpty, `Delta should be empty but had ${delta.entityChanges.length} entity changes and ${delta.relationshipChanges.length} relationship changes`);
  });
});

describe("E2E: Document-level severity", () => {
  let repo: FixtureRepo;
  
  afterEach(() => { repo?.cleanup(); });

  it("artifact severity comes from triggering domains, not overall", () => {
    repo = createFixtureRepo();
    repo.writeFile("package.json", BASE_PACKAGE_JSON);
    repo.writeFile("tsconfig.json", BASE_TSCONFIG);
    repo.writeFile("docforce.yml", baseDocforceYml());
    repo.writeFile("src/app/index.ts", 'export function main() { console.log("app"); }\n');
    repo.writeFile("src/utils/index.ts", 'export function helper() { return 42; }\n');
    repo.commit("initial");
    
    repo.writeFile("src/queue/index.ts", 'export function enqueue(item: string) { return item; }\n');
    repo.writeFile("src/app/index.ts", 'import { helper } from "../utils/index.js";\nexport function main() { console.log(helper()); }\n');
    repo.commit("add queue + import");
    
    const report = analyzeChangeImpact({ baseRef: "HEAD~1", headRef: "HEAD", repoRoot: repo.dir });
    
    assert.equal(report.overallImpactLevel, "high");
    
    const evidence = report.documentImpacts.find((d) => d.artifact === "architecture-evidence.md");
    if (evidence?.affected) {
      assert.ok(evidence.impactLevel === "medium" || evidence.impactLevel === "high",
        `Evidence artifact severity should be medium or high, got ${evidence.impactLevel}`);
    }
    
    const validation = validateImpactReport(report);
    assert.ok(validation.valid, `Validation errors: ${validation.errors.join(", ")}`);
  });
});

describe("E2E: Report terminology", () => {
  let repo: FixtureRepo;
  
  afterEach(() => { repo?.cleanup(); });

  it("uses correct terminology for empty delta with manual review", async () => {
    repo = createFixtureRepo();
    setupBaselineRepo(repo);
    
    repo.writeFile("src/app/utils.ts", 'export function formatDate(d: Date): string { return "CHANGED"; }\n');
    repo.commit("change behavior");
    
    const report = analyzeChangeImpact({ baseRef: "HEAD~1", headRef: "HEAD", repoRoot: repo.dir });
    
    const { generateReports } = await import("./reportGenerator.js");
    const { mdPath } = generateReports(report, repo.dir);
    const md = readFileSync(mdPath, "utf-8");
    
    assert.ok(!md.includes("no documentation changes are needed"), "Should not claim no changes needed");
    assert.ok(!md.includes("No documentation changes"), "Should not claim no documentation changes");
    assert.ok(md.includes("No deterministic architecture-documentation impact"), 
      "Should use 'no deterministic impact' language");
  });
});
