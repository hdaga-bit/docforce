import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DOCFORCE_VERSION } from "./version.js";
import { removeTree } from "./path/fs.js";
import {
  resolveInstalledCliEntry,
  runNodeScript,
  runNpm,
} from "./runtime/exec.js";
import { toModelPath } from "./path/canonical.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Pack-install invokes the consumer CLI as:
 *   node <installed-package>/dist/cli.js <command>
 *
 * That avoids `node_modules/.bin/docforce` (a POSIX script) and
 * `docforce.cmd` (Windows-only), and does not assume a sibling
 * `../docforce` checkout.
 */
describe("Packaged install into an isolated consumer", () => {
  const work = mkdtempSync(join(tmpdir(), "docforce-consumer-"));
  const consumer = join(work, "app");
  let tarball = "";
  let cliEntry = "";

  after(() => {
    removeTree(work);
    if (tarball && existsSync(tarball)) {
      try { removeTree(tarball); } catch { /* ignore */ }
    }
  });

  it("installs from npm pack without a sibling ../docforce path", () => {
    assert.ok(!toModelPath(work).includes("/opt/maryforce"), "fixture must live outside the MaryForce tree");

    const npmEnv = {
      ...process.env,
      npm_config_fund: "false",
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
    };
    runNpm(["pack"], { cwd: packageRoot, env: npmEnv, timeout: 180_000 });
    tarball = join(packageRoot, `mary-docforce-${DOCFORCE_VERSION}.tgz`);
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

    runNpm(["install", tarball], {
      cwd: consumer,
      timeout: 240_000,
      env: { ...process.env, npm_config_fund: "false", PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" },
    });
    assert.ok(!existsSync(join(consumer, "..", "docforce", "package.json")));
    const installedRoot = join(consumer, "node_modules", "@mary", "docforce");
    assert.ok(existsSync(join(installedRoot, "package.json")));
    cliEntry = resolveInstalledCliEntry(installedRoot);
    assert.ok(existsSync(cliEntry));
  });

  it("docforce analyze inspects the consumer repository, not the package", () => {
    const out = runNodeScript(cliEntry, ["analyze"], { cwd: consumer });
    assert.ok(out.includes(`Repository: ${consumer}`));
    assert.ok(out.includes(`@mary/docforce ${DOCFORCE_VERSION}`));
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
    assert.equal(model.metadata.docforceVersion, DOCFORCE_VERSION);
    assert.equal(resolve(model.metadata.repositoryRoot), resolve(consumer));
  });

  it("docforce generate writes consumer docs from the consumer model", () => {
    const out = runNodeScript(cliEntry, ["generate"], { cwd: consumer });
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
