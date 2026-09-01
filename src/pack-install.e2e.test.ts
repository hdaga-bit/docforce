import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 120_000,
    env: { ...process.env, npm_config_fund: "false" },
  });
}

describe("Packaged install into an isolated consumer", () => {
  const work = mkdtempSync(join(tmpdir(), "docforce-consumer-"));
  const consumer = join(work, "app");
  let tarball = "";

  after(() => {
    rmSync(work, { recursive: true, force: true });
    if (tarball && existsSync(tarball)) {
      try { rmSync(tarball); } catch { /* ignore */ }
    }
  });

  it("installs from npm pack without a sibling ../docforce path", () => {
    assert.ok(!work.startsWith("/opt/maryforce"), "fixture must live outside the MaryForce tree");

    run("npm", ["pack"], packageRoot);
    tarball = join(packageRoot, "mary-docforce-1.3.0.tgz");
    assert.ok(existsSync(tarball));

    mkdirSync(consumer, { recursive: true });
    writeFileSync(join(consumer, "package.json"), JSON.stringify({
      name: "isolated-consumer",
      version: "1.0.0",
      type: "module",
      private: true,
    }, null, 2));
    writeFileSync(join(consumer, "docforce.yml"), `product:
  name: IsolatedConsumer
  type: application
  description: Temporary fixture for DocForce pack-install verification

scanning:
  rootDir: "."
  include:
    - "src/**"
    - "package.json"
  exclude:
    - "node_modules/**"

analysis:
  exclude: []
`);
    mkdirSync(join(consumer, "src", "app"), { recursive: true });
    writeFileSync(join(consumer, "src", "app", "index.ts"), "export function hello() { return \"ok\"; }\n");

    run("npm", ["install", tarball], consumer);
    assert.ok(!existsSync(join(consumer, "..", "docforce", "package.json")));
    assert.ok(existsSync(join(consumer, "node_modules", "@mary", "docforce", "package.json")));
    assert.ok(existsSync(join(consumer, "node_modules", "@mary", "docforce", "dist", "cli.js")));
  });

  it("docforce analyze inspects the consumer repository, not the package", () => {
    const bin = join(consumer, "node_modules", ".bin", "docforce");
    const out = run(bin, ["analyze"], consumer);
    assert.ok(out.includes(`Repository: ${consumer}`));
    assert.match(out, /@mary\/docforce 1\.3\.0/);
    assert.ok(!out.includes("/opt/maryforce/orchestrator"));

    const modelPath = join(consumer, ".docforce", "system-model.json");
    assert.ok(existsSync(modelPath));
    const model = JSON.parse(readFileSync(modelPath, "utf-8")) as {
      product: { name: string };
      components: { id: string }[];
      metadata: { repositoryRoot: string; docforceVersion: string };
    };
    assert.equal(model.product.name, "IsolatedConsumer");
    assert.ok(model.components.some((c) => c.id === "app"));
    assert.ok(!model.components.some((c) => c.id === "scanner" || c.id === "pr"));
    assert.equal(model.metadata.docforceVersion, "1.3.0");
    assert.ok(model.metadata.repositoryRoot.startsWith(consumer));
  });

  it("docforce generate writes consumer docs from the consumer model", () => {
    const bin = join(consumer, "node_modules", ".bin", "docforce");
    const out = run(bin, ["generate"], consumer);
    assert.ok(out.includes("docs/generated/technical-overview.md"));
    assert.ok(out.includes("docs/generated/technical-architecture.md"));
    const overview = readFileSync(join(consumer, "docs", "generated", "technical-overview.md"), "utf-8");
    assert.ok(overview.includes("IsolatedConsumer"));
    assert.ok(!overview.includes("MaryForce"));
    const flagship = readFileSync(join(consumer, "docs", "generated", "technical-architecture.md"), "utf-8");
    assert.ok(flagship.includes("IsolatedConsumer"));
    assert.ok(flagship.includes("Architecture selection rationale is not currently available"));
  });
});
