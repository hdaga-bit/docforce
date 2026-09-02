import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../config/index.js";
import { SAFE_EXCLUDES, inferRepository, trialConfig, TRIAL_DIR } from "./infer.js";
import { runInit } from "./init.js";
import { runDoctor } from "./doctor.js";
import { runTry } from "./try.js";
import { runOnboarded } from "./run.js";
import { renderFeedbackTemplate } from "./feedback.js";
import { formatTryReport } from "./try.js";

const rendererOk = async () => ({ ok: true as const });
const rendererMissing = async () => ({ ok: false as const, error: "chromium missing" });

describe("v1.4.1 beta onboarding", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `docforce-onboard-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("A. Node src/ repo init", () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "node-app", description: "A node app" }));
    mkdirSync(join(tmpDir, "src"));
    writeFileSync(join(tmpDir, "src", "index.ts"), "export const n = 1;\n");
    const result = runInit({ repoRoot: tmpDir, yes: true });
    assert.equal(result.wrote, true);
    const config = loadConfig(join(tmpDir, "docforce.yml"));
    assert.equal(config.product.name, "node-app");
    assert.ok(config.scanning.include.includes("src/**"));
    assert.ok(config.scanning.include.includes("package.json"));
    for (const ex of SAFE_EXCLUDES) assert.ok(config.scanning.exclude.includes(ex));
  });

  it("B. Next app/lib/components repo init", () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({
      name: "@acme/askmary",
      dependencies: { next: "16.0.0", react: "19.0.0" },
    }));
    mkdirSync(join(tmpDir, "app"), { recursive: true });
    mkdirSync(join(tmpDir, "lib"), { recursive: true });
    mkdirSync(join(tmpDir, "components"), { recursive: true });
    writeFileSync(join(tmpDir, "app", "page.tsx"), "export default function Page() { return null; }\n");
    const inferred = inferRepository({ repoRoot: tmpDir });
    assert.equal(inferred.productName, "askmary");
    assert.equal(inferred.productType, "web-application");
    assert.ok(inferred.include.includes("app/**"));
    assert.ok(inferred.include.includes("lib/**"));
    assert.ok(inferred.include.includes("components/**"));
    assert.ok(inferred.detected.includes("Next.js"));
    assert.ok(inferred.detected.includes("TypeScript") || inferred.detected.includes("Node.js"));
  });

  it("C. mixed TS/Python repo init", () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "mixed" }));
    mkdirSync(join(tmpDir, "src"));
    writeFileSync(join(tmpDir, "src", "app.ts"), "export const x = 1;\n");
    mkdirSync(join(tmpDir, "litert"));
    writeFileSync(join(tmpDir, "litert", "server.py"), "print('ok')\n");
    writeFileSync(join(tmpDir, "requirements.txt"), "fastapi==0.110.0\n");
    const inferred = inferRepository({ repoRoot: tmpDir });
    assert.ok(inferred.include.includes("src/**"));
    assert.ok(inferred.include.includes("litert/**"));
    assert.ok(inferred.include.includes("requirements.txt"));
    assert.ok(inferred.detected.includes("Python"));
  });

  it("D. existing config is not overwritten", () => {
    writeFileSync(join(tmpDir, "docforce.yml"), "product:\n  name: KeepMe\n  type: application\n  description: stay\n");
    const before = readFileSync(join(tmpDir, "docforce.yml"), "utf-8");
    const result = runInit({ repoRoot: tmpDir, yes: true });
    assert.equal(result.wrote, false);
    assert.match(result.message, /already exists/);
    assert.equal(readFileSync(join(tmpDir, "docforce.yml"), "utf-8"), before);
  });

  it("E. non-interactive init --yes", () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "silent" }));
    mkdirSync(join(tmpDir, "src"));
    const result = runInit({ repoRoot: tmpDir, yes: true, name: "SilentApp", organization: "Example Org" });
    assert.equal(result.wrote, true);
    const yml = readFileSync(join(tmpDir, "docforce.yml"), "utf-8");
    assert.match(yml, /name: "SilentApp"/);
    assert.match(yml, /Example Org/);
  });

  it("F. doctor ready", async () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "ready-app" }));
    mkdirSync(join(tmpDir, "src"));
    writeFileSync(join(tmpDir, "src", "index.ts"), "export const n = 1;\n");
    mkdirSync(join(tmpDir, ".git"));
    runInit({ repoRoot: tmpDir, yes: true });
    const doctor = await runDoctor({ repoRoot: tmpDir, requireConfig: true, diagnoseRenderer: rendererOk });
    assert.equal(doctor.status, "READY");
    assert.ok(doctor.checks.every((c) => c.status === "READY"));
  });

  it("G. doctor missing Chromium is a warning", async () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "warn-app" }));
    mkdirSync(join(tmpDir, "src"));
    mkdirSync(join(tmpDir, ".git"));
    runInit({ repoRoot: tmpDir, yes: true });
    const doctor = await runDoctor({ repoRoot: tmpDir, requireConfig: true, diagnoseRenderer: rendererMissing });
    assert.equal(doctor.status, "WARNING");
    const chromium = doctor.checks.find((c) => c.id === "chromium");
    assert.equal(chromium?.status, "WARNING");
    assert.ok(!doctor.checks.some((c) => c.status === "ERROR"));
  });

  it("H. try creates no docforce.yml", async () => {
    seedNodeRepo(tmpDir);
    const result = await runTry({ repoRoot: tmpDir, diagnoseRenderer: rendererMissing });
    assert.equal(existsSync(join(tmpDir, "docforce.yml")), false);
    assert.equal(result.wroteConfig, false);
  });

  it("I. try modifies no source", async () => {
    seedNodeRepo(tmpDir);
    const source = join(tmpDir, "src", "index.ts");
    const before = readFileSync(source, "utf-8");
    await runTry({ repoRoot: tmpDir, diagnoseRenderer: rendererMissing });
    assert.equal(readFileSync(source, "utf-8"), before);
    assert.equal(existsSync(join(tmpDir, "docs", "generated")), false);
    assert.equal(existsSync(join(tmpDir, "docs", "published")), false);
  });

  it("J. trial outputs only under .docforce/trial", async () => {
    seedNodeRepo(tmpDir);
    const result = await runTry({ repoRoot: tmpDir, diagnoseRenderer: rendererMissing });
    assert.ok(result.generated.every((path) => path.replace(/\\/g, "/").startsWith(`${TRIAL_DIR}/`)));
    assert.ok(result.feedbackPath.replace(/\\/g, "/").startsWith(`${TRIAL_DIR}/`));
    assert.ok(existsSync(join(tmpDir, TRIAL_DIR, "FEEDBACK.md")));
    assert.ok(existsSync(join(tmpDir, TRIAL_DIR, "system-model.json")));
    walkFiles(tmpDir).forEach((rel) => {
      if (rel.startsWith(".docforce/trial/")) return;
      if (rel === ".docforce" || rel === ".docforce/.doctor-write-probe") return;
      if (rel.startsWith("src/") || rel === "package.json") return;
      if (rel.startsWith(".git")) return;
      assert.fail(`unexpected trial write: ${rel}`);
    });
  });

  it("K. trial summary", async () => {
    seedNodeRepo(tmpDir);
    const result = await runTry({ repoRoot: tmpDir, name: "AskMary", diagnoseRenderer: rendererMissing });
    const text = formatTryReport(result);
    assert.match(text, /DocForce Trial/);
    assert.match(text, /AskMary/);
    assert.match(text, /components/);
    assert.match(text, /relationships/);
    assert.match(text, /Coverage:/);
    assert.match(text, /To adopt DocForce/);
    assert.equal(result.summary.product, "AskMary");
  });

  it("L. renderer missing graceful fallback", async () => {
    seedNodeRepo(tmpDir);
    const result = await runTry({ repoRoot: tmpDir, diagnoseRenderer: rendererMissing });
    assert.equal(result.published.length, 0);
    assert.ok(result.publicationSkipped);
    assert.match(formatTryReport(result), /Publication renderer unavailable/);
    assert.match(formatTryReport(result), /npx playwright install chromium/);
    assert.ok(!existsSync(join(tmpDir, TRIAL_DIR, "AskMary-Technical-Architecture.pdf")));
  });

  it("M. run requires real config", async () => {
    seedNodeRepo(tmpDir);
    await assert.rejects(
      () => runOnboarded({ repoRoot: tmpDir, noPublish: true, diagnoseRenderer: rendererOk }),
      /docforce.yml|ERROR/,
    );
  });

  it("N. run --no-publish", async () => {
    seedNodeRepo(tmpDir);
    mkdirSync(join(tmpDir, ".git"));
    runInit({ repoRoot: tmpDir, yes: true, name: "RunApp" });
    const result = await runOnboarded({ repoRoot: tmpDir, noPublish: true, diagnoseRenderer: rendererOk });
    assert.ok(result.generated.some((path) => path.includes("docs/generated/")));
    assert.equal(result.published.length, 0);
    assert.match(result.publicationSkipped ?? "", /--no-publish/);
    assert.equal(existsSync(join(tmpDir, "docs", "published")), false);
  });

  it("O. feedback template", async () => {
    seedNodeRepo(tmpDir);
    const result = await runTry({ repoRoot: tmpDir, name: "AskMary", diagnoseRenderer: rendererMissing });
    const text = readFileSync(join(tmpDir, result.feedbackPath), "utf-8");
    assert.match(text, /# DocForce Beta Feedback/);
    assert.match(text, /Repository: AskMary/);
    assert.match(text, /Setup ease/);
    assert.match(text, /What important architecture did DocForce miss/);
    assert.equal(text, renderFeedbackTemplate("AskMary"));
  });

  it("P. Windows-safe trial output paths", async () => {
    seedNodeRepo(tmpDir);
    const result = await runTry({ repoRoot: tmpDir, diagnoseRenderer: rendererMissing });
    assert.ok(result.generated.every((path) => !path.includes("\\")));
    assert.ok(!result.feedbackPath.includes("\\"));
  });

  it("Q. Linux/POSIX path semantics", () => {
    const inferred = inferRepository({ repoRoot: tmpDir, name: "PosixApp" });
    const trial = trialConfig(inferred);
    assert.ok(trial.output.systemModel.startsWith(".docforce/trial/"));
    assert.ok(!trial.output.systemModel.includes("\\"));
    assert.equal(trial.publication?.outputDir, ".docforce/trial");
  });

  it("R. dirty Git working tree remains untouched", async () => {
    seedNodeRepo(tmpDir);
    const dirty = join(tmpDir, "src", "dirty.ts");
    writeFileSync(dirty, "export const dirty = true;\n");
    const before = readFileSync(dirty, "utf-8");
    await runTry({ repoRoot: tmpDir, diagnoseRenderer: rendererMissing });
    assert.equal(readFileSync(dirty, "utf-8"), before);
    assert.equal(existsSync(join(tmpDir, "docforce.yml")), false);
  });
});

function seedNodeRepo(dir: string): void {
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "seed-app", dependencies: { typescript: "5.0.0" } }));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "index.ts"), "export function hello() { return \"ok\"; }\n");
}

function walkFiles(root: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    const rel = prefix ? `${prefix}/${name}` : name;
    const abs = join(root, name);
    if (statSync(abs).isDirectory()) out.push(...walkFiles(abs, rel));
    else out.push(rel.replace(/\\/g, "/"));
  }
  return out;
}
