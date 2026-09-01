import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { removeTree } from "../path/fs.js";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runAiReview } from "./index.js";
import { FakeProvider, FailingProvider, TimeoutProvider } from "./fakeProvider.js";
import { collectContext, shouldCollectFile } from "./contextCollector.js";
import { extractAssessment, parseClaudePrintJson } from "./claudeCliProvider.js";
import { scanWorkingTree } from "../impact/worktree.js";
import { analyzeChangeImpact } from "../impact/index.js";

interface FixtureRepo {
  readonly dir: string;
  commit(message: string): string;
  writeFile(path: string, content: string): void;
  cleanup(): void;
}

function createFixtureRepo(): FixtureRepo {
  const dir = join(tmpdir(), `docforce-review-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
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
    cleanup(): void {
      try {
        try { execSync("git worktree prune", { cwd: dir, stdio: "pipe" }); } catch { /* ignore */ }
        removeTree(dir);
      } catch { /* ignore */ }
    },
  };
}

const PACKAGE_JSON = JSON.stringify({
  name: "test-app",
  version: "1.0.0",
  type: "module",
  dependencies: {},
}, null, 2);

function docforceYml(): string {
  return `schemaVersion: "0.7.0"

product:
  name: TestApp
  type: application
  description: Test application for DocForce AI review e2e

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
  components: {}

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

function setupBaseline(repo: FixtureRepo): string {
  repo.writeFile("package.json", PACKAGE_JSON);
  repo.writeFile("docforce.yml", docforceYml());
  repo.writeFile("src/app/auth.ts", "export function canExecute(_task: unknown) {\n  return true;\n}\n");
  repo.writeFile("src/app/index.ts", 'export function main() { console.log("ok"); }\n');
  return repo.commit("baseline");
}

describe("Review E2E: authorization change through FakeProvider", () => {
  let repo: FixtureRepo;
  afterEach(() => { repo?.cleanup(); });

  it("produces security/authorization recommendations without writing product docs", async () => {
    repo = createFixtureRepo();
    setupBaseline(repo);
    repo.writeFile("src/app/auth.ts", 'export function canExecute(task: { requester: { role: string } }) {\n  return task.requester.role === "admin";\n}\n');
    repo.commit("feat: require admin role");

    const report = await runAiReview(
      { baseRef: "HEAD~1", headRef: "HEAD", repoRoot: repo.dir, forceAiReview: true },
      new FakeProvider(),
    );

    assert.ok(report.result.triggered);
    assert.ok(report.result.assessment);
    assert.ok(report.result.assessment!.concerns.includes("authorization") ||
      report.result.assessment!.concerns.includes("security"));
    assert.equal(existsSync(join(repo.dir, "docs/generated/technical-overview.md")), false);
    assert.ok(existsSync(join(repo.dir, ".docforce/reports/ai-change-review.md")));
    const md = readFileSync(join(repo.dir, ".docforce/reports/ai-change-review.md"), "utf-8");
    assert.ok(md.includes("Trust Notice"));
    assert.ok(md.includes("not") && md.includes("deterministic repository facts"));
  });
});

describe("Review E2E: provider failure preserves deterministic analysis", () => {
  let repo: FixtureRepo;
  afterEach(() => { repo?.cleanup(); });

  it("records AI failure and does not invent an assessment", async () => {
    repo = createFixtureRepo();
    setupBaseline(repo);
    repo.writeFile("src/app/auth.ts", 'export function canExecute() { return false; }\n');
    repo.commit("fix: deny by default");

    const impact = analyzeChangeImpact({ baseRef: "HEAD~1", headRef: "HEAD", repoRoot: repo.dir });

    const report = await runAiReview(
      { baseRef: "HEAD~1", headRef: "HEAD", repoRoot: repo.dir, forceAiReview: true },
      new FailingProvider(),
    );

    assert.ok(report.result.triggered);
    assert.ok(report.result.error);
    assert.equal(report.result.assessment, undefined);
    assert.equal(report.deterministic.manualReviewRecommended, impact.manualReviewRecommended);
    assert.ok(existsSync(join(repo.dir, ".docforce/reports/ai-change-review.md")));
  });

  it("timeout is treated as provider unavailable", async () => {
    repo = createFixtureRepo();
    setupBaseline(repo);
    repo.writeFile("src/app/index.ts", 'export function main() { console.log("changed"); }\n');
    repo.commit("chore: log change");

    const report = await runAiReview(
      { baseRef: "HEAD~1", headRef: "HEAD", repoRoot: repo.dir, forceAiReview: true },
      new TimeoutProvider(),
    );

    assert.ok(report.result.error?.includes("timed out"));
    assert.equal(report.result.assessment, undefined);
  });
});

describe("Review E2E: skip generated-docs and tests", () => {
  let repo: FixtureRepo;
  afterEach(() => { repo?.cleanup(); });

  it("does not call the provider for generated-doc-only commits", async () => {
    repo = createFixtureRepo();
    setupBaseline(repo);
    repo.writeFile("docs/generated/technical-overview.md", "# Generated\n> Generated by DocForce\n");
    repo.commit("docs: regenerate");

    let called = false;
    const spy: FakeProvider = new FakeProvider();
    const original = spy.analyzeChange.bind(spy);
    spy.analyzeChange = async (...args) => {
      called = true;
      return original(...args);
    };

    const report = await runAiReview(
      { baseRef: "HEAD~1", headRef: "HEAD", repoRoot: repo.dir },
      spy,
    );

    assert.equal(report.result.triggered, false);
    assert.equal(called, false);
  });

  it("does not call the provider for test-only commits", async () => {
    repo = createFixtureRepo();
    setupBaseline(repo);
    repo.writeFile("src/app/auth.test.ts", 'import { describe, it } from "node:test";\nit("x", () => {});\n');
    repo.commit("test: add auth test");

    let called = false;
    const spy: FakeProvider = new FakeProvider();
    const original = spy.analyzeChange.bind(spy);
    spy.analyzeChange = async (...args) => {
      called = true;
      return original(...args);
    };

    const report = await runAiReview(
      { baseRef: "HEAD~1", headRef: "HEAD", repoRoot: repo.dir },
      spy,
    );

    assert.equal(report.result.triggered, false);
    assert.equal(called, false);
  });
});

describe("Review E2E: .env is never sent", () => {
  let repo: FixtureRepo;
  afterEach(() => { repo?.cleanup(); });

  it("excludes .env from collected context even when it changed", () => {
    repo = createFixtureRepo();
    setupBaseline(repo);
    repo.writeFile(".env", "SECRET_PASSWORD=supersecretvalue\nAPI_KEY=sk-abcdefghijklmnopqrstuvwxyz123456\n");
    repo.writeFile("src/app/index.ts", 'export function main() { console.log("ok2"); }\n');
    repo.commit("chore: env and log");

    const impact = analyzeChangeImpact({ baseRef: "HEAD~1", headRef: "HEAD", repoRoot: repo.dir });
    const model = scanWorkingTree(repo.dir);
    const ctx = collectContext(repo.dir, impact, model);

    assert.equal(shouldCollectFile(".env"), false);
    assert.ok(!ctx.changedFiles.some((f) => f.path.includes(".env")));
    const blob = JSON.stringify(ctx);
    assert.ok(!blob.includes("supersecretvalue"));
  });
});

describe("Claude CLI JSON extraction (no live call)", () => {
  it("extracts a schema-valid assessment from a print JSON envelope", () => {
    const assessment = {
      behavioralChangeDetected: true,
      summary: "Retry count increased",
      concerns: ["reliability"],
      confidence: "medium",
      documentationRecommendations: [{
        area: "reliability",
        impact: "medium",
        reason: "Retry policy changed",
        evidence: [{ path: "src/http.ts", startLine: 1, endLine: 2 }],
      }],
      evidence: [{ path: "src/http.ts", startLine: 1, endLine: 2 }],
      uncertainties: [],
      requiresHumanConfirmation: false,
    };
    const stdout = JSON.stringify({
      type: "result",
      result: JSON.stringify(assessment),
      session_id: "sess-1",
      model: "claude-test",
      is_error: false,
    });
    const parsed = parseClaudePrintJson(stdout);
    assert.equal(parsed.sessionId, "sess-1");
    const extracted = extractAssessment(parsed.resultText);
    assert.equal(extracted.summary, "Retry count increased");
  });

  it("rejects malformed Claude payloads", () => {
    assert.throws(() => extractAssessment("not json at all"));
  });
});
