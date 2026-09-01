import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanPackageJson } from "./packageJson.js";
import { scanTsconfig } from "./tsconfig.js";
import { scanDocker } from "./docker.js";
import { scanGithubActions } from "./github.js";
import { scanSystemd } from "./systemd.js";
import { scanEnvironment } from "./environment.js";
import { scanDatabase } from "./database.js";
import { scanSourceImports, collectImports } from "./sourceImports.js";
import { runAllScanners } from "./index.js";
import { isExcluded } from "./exclusions.js";

describe("PackageJson Scanner", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `docforce-test-pkg-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects Node.js runtime from package.json", () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({
      name: "test-app",
      dependencies: {},
    }));
    const findings = scanPackageJson(tmpDir);
    assert.ok(findings.runtime.length > 0);
    assert.equal(findings.runtime[0]!.name, "Node.js");
    assert.equal(findings.runtime[0]!.provenance.kind, "observation");
  });

  it("detects TypeScript from devDependencies", () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({
      name: "test-app",
      devDependencies: { typescript: "^7.0.2" },
    }));
    const findings = scanPackageJson(tmpDir);
    const ts = findings.languages.find((l) => l.name === "TypeScript");
    assert.ok(ts);
    assert.equal(ts.version, "7.0.2");
    assert.equal(ts.provenance.kind, "observation");
  });

  it("detects ESM from package type field", () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({
      name: "test-app",
      type: "module",
    }));
    const findings = scanPackageJson(tmpDir);
    const esm = findings.languages.find((l) => l.name.includes("ESM"));
    assert.ok(esm);
  });

  it("detects Slack Bolt dependency", () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({
      name: "test-app",
      dependencies: { "@slack/bolt": "^5.0.0" },
    }));
    const findings = scanPackageJson(tmpDir);
    const slack = findings.technologies.find((t) => t.name === "@slack/bolt");
    assert.ok(slack);
    assert.equal(slack.category, "messaging");
    assert.equal(slack.provenance.kind, "observation");
    assert.equal(slack.provenance.evidence[0]!.sourceFile, "package.json");
  });

  it("detects node:test runner from scripts", () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({
      name: "test-app",
      scripts: { test: "tsx --test src/**/*.test.ts" },
    }));
    const findings = scanPackageJson(tmpDir);
    const testRunner = findings.technologies.find((t) => t.name === "node:test");
    assert.ok(testRunner);
    assert.equal(testRunner.category, "testing");
  });

  it("returns empty findings for missing package.json", () => {
    const findings = scanPackageJson(tmpDir);
    assert.equal(findings.runtime.length, 0);
    assert.equal(findings.languages.length, 0);
    assert.equal(findings.technologies.length, 0);
  });

  it("records evidence with source file reference", () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({
      name: "test-app",
      dependencies: { zod: "^4.4.3" },
    }));
    const findings = scanPackageJson(tmpDir);
    const zod = findings.technologies.find((t) => t.name === "zod");
    assert.ok(zod);
    assert.equal(zod.provenance.evidence[0]!.sourceFile, "package.json");
    assert.ok(zod.provenance.evidence[0]!.detail?.includes("zod@"));
  });
});

describe("Tsconfig Scanner", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `docforce-test-ts-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects ECMAScript target", () => {
    writeFileSync(join(tmpDir, "tsconfig.json"), JSON.stringify({
      compilerOptions: { target: "ES2022", module: "NodeNext" },
    }));
    const findings = scanTsconfig(tmpDir);
    const es = findings.languages.find((l) => l.name === "ECMAScript");
    assert.ok(es);
    assert.equal(es.version, "ES2022");
  });

  it("detects strict mode", () => {
    writeFileSync(join(tmpDir, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true },
    }));
    const findings = scanTsconfig(tmpDir);
    const strict = findings.technologies.find((t) => t.name === "TypeScript Strict Mode");
    assert.ok(strict);
  });

  it("returns empty for missing tsconfig", () => {
    const findings = scanTsconfig(tmpDir);
    assert.equal(findings.languages.length, 0);
    assert.equal(findings.technologies.length, 0);
  });
});

describe("Docker Scanner", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `docforce-test-docker-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects Dockerfile with base image", () => {
    writeFileSync(join(tmpDir, "Dockerfile"), "FROM node:22-alpine\nEXPOSE 3000\n");
    const findings = scanDocker(tmpDir);
    assert.ok(findings.technologies.some((t) => t.name === "Docker"));
    const image = findings.infrastructure.find((i) => i.type === "container-image");
    assert.ok(image);
    assert.ok(image.name.includes("node:22-alpine"));
  });

  it("returns empty for no Docker files", () => {
    const findings = scanDocker(tmpDir);
    assert.equal(findings.technologies.length, 0);
    assert.equal(findings.infrastructure.length, 0);
  });
});

describe("GitHub Actions Scanner", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `docforce-test-gh-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects workflow files", () => {
    mkdirSync(join(tmpDir, ".github", "workflows"), { recursive: true });
    writeFileSync(join(tmpDir, ".github", "workflows", "ci.yml"), `
name: CI
on:
  push:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test
`);
    const findings = scanGithubActions(tmpDir);
    assert.ok(findings.technologies.some((t) => t.name === "GitHub Actions"));
    assert.ok(findings.workflows.length > 0);
    assert.equal(findings.workflows[0]!.name, "CI");
  });

  it("returns empty for no .github directory", () => {
    const findings = scanGithubActions(tmpDir);
    assert.equal(findings.workflows.length, 0);
    assert.equal(findings.technologies.length, 0);
  });
});

describe("Systemd Scanner", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `docforce-test-systemd-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects systemd service files", () => {
    writeFileSync(join(tmpDir, "myapp.service"), `
[Unit]
Description=My Application
After=network-online.target docker.service
Requires=docker.service

[Service]
User=appuser
ExecStart=/usr/bin/node app.js
WorkingDirectory=/opt/myapp

[Install]
WantedBy=multi-user.target
`);
    const findings = scanSystemd(tmpDir);
    assert.ok(findings.infrastructure.length > 0);
    const service = findings.infrastructure.find((i) => i.type === "systemd-service");
    assert.ok(service);
    assert.ok(service.detail?.includes("User: appuser"));
  });
});

describe("Environment Scanner", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `docforce-test-env-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects environment variables from .env.example", () => {
    writeFileSync(join(tmpDir, ".env.example"), `
SLACK_BOT_TOKEN=xoxb-your-bot-token
NODE_ENV=development
# Database path
APP_DB_PATH=/var/lib/example/app.db
`);
    const findings = scanEnvironment(tmpDir);
    assert.ok(findings.technologies.length > 0);
    assert.ok(findings.variables.length > 0);
    const dbVar = findings.variables.find((v) => v.name === "APP_DB_PATH");
    assert.ok(dbVar);
    assert.equal(dbVar.provenance.kind, "observation");
  });
});

describe("Database Scanner", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `docforce-test-db-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects SQLite from package dependencies", () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({
      name: "test-app",
      dependencies: { "better-sqlite3": "^9.0.0" },
    }));
    const findings = scanDatabase(tmpDir);
    const sqlite = findings.datastores.find((d) => d.engine === "SQLite");
    assert.ok(sqlite);
    assert.equal(sqlite.type, "embedded-database");
  });

  it("detects PostgreSQL from env config", () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "test" }));
    writeFileSync(join(tmpDir, ".env.example"), "DATABASE_URL=postgres://user:pass@localhost/mydb\n");
    const findings = scanDatabase(tmpDir);
    const pg = findings.datastores.find((d) => d.engine === "PostgreSQL");
    assert.ok(pg);
    assert.equal(pg.provenance.kind, "inference");
  });

  it("detects node:sqlite from source imports", () => {
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "store.ts"), `
import { DatabaseSync } from "node:sqlite";
export function openDb() { return new DatabaseSync(":memory:"); }
`);
    const findings = scanDatabase(tmpDir);
    const nodeSqlite = findings.datastores.find((d) => d.name.includes("node:sqlite"));
    assert.ok(nodeSqlite);
    assert.equal(nodeSqlite.provenance.kind, "observation");
    assert.ok(nodeSqlite.provenance.evidence.some((e) => e.evidenceType === "database-import"));
  });

  it("detects database paths from env variables", () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "test" }));
    writeFileSync(join(tmpDir, ".env.example"), "DB_PATH=/data/app.db\n");
    const findings = scanDatabase(tmpDir);
    const sqlite = findings.datastores.find((d) => d.engine === "SQLite" && d.location);
    assert.ok(sqlite);
    assert.equal(sqlite.location, "/data/app.db");
  });

  it("returns empty findings for no database signals", () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({
      name: "test",
      dependencies: { express: "^4.0.0" },
    }));
    const findings = scanDatabase(tmpDir);
    assert.equal(findings.datastores.length, 0);
  });
});

describe("Source Import Scanner", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `docforce-test-src-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("discovers top-level source directories as components", () => {
    mkdirSync(join(tmpDir, "src", "auth"), { recursive: true });
    mkdirSync(join(tmpDir, "src", "api"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "auth", "index.ts"), "export function login() {}");
    writeFileSync(join(tmpDir, "src", "api", "index.ts"), "export function handler() {}");

    const findings = scanSourceImports(tmpDir);
    assert.ok(findings.components.length >= 2);
    assert.ok(findings.components.some((c) => c.name === "auth"));
    assert.ok(findings.components.some((c) => c.name === "api"));
  });

  it("detects Slack integration from imports", () => {
    mkdirSync(join(tmpDir, "src", "slack"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "slack", "app.ts"), `
import { App } from "@slack/bolt";
export const app = new App({});
`);
    const findings = scanSourceImports(tmpDir);
    const slack = findings.integrations.find((i) => i.name.includes("Slack"));
    assert.ok(slack);
    assert.equal(slack.direction, "bidirectional");
  });
});

describe("Scanner Orchestrator", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `docforce-test-all-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("merges results from all scanners", () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({
      name: "test-app",
      type: "module",
      dependencies: { "@slack/bolt": "^5.0.0" },
      devDependencies: { typescript: "^7.0.0" },
    }));
    writeFileSync(join(tmpDir, "tsconfig.json"), JSON.stringify({
      compilerOptions: { target: "ES2022", strict: true },
    }));
    mkdirSync(join(tmpDir, "src", "slack"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "slack", "index.ts"), "export {};");

    const results = runAllScanners(tmpDir);
    assert.ok(results.runtime.length > 0);
    assert.ok(results.languages.length > 0);
    assert.ok(results.technologies.length > 0);
    assert.ok(results.components.length > 0);
    assert.ok(results.unknowns.length > 0);
  });

  it("identifies unknown areas when CI/CD is missing", () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "test" }));
    const results = runAllScanners(tmpDir);
    const ciUnknown = results.unknowns.find((u) => u.area === "CI/CD");
    assert.ok(ciUnknown);
    assert.ok(ciUnknown.reason.includes("No .github/workflows"));
  });

  it("identifies unknown areas when Docker is missing", () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "test" }));
    const results = runAllScanners(tmpDir);
    const dockerUnknown = results.unknowns.find((u) => u.area === "Containerization");
    assert.ok(dockerUnknown);
  });

  it("always marks architecture rationale as unknown", () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "test" }));
    const results = runAllScanners(tmpDir);
    const rationale = results.unknowns.find((u) => u.area === "Architecture Rationale");
    assert.ok(rationale);
    assert.ok(rationale.reason.includes("ADR"));
  });
});

describe("Exclusion Utility", () => {
  it("matches simple glob patterns", () => {
    assert.equal(isExcluded("src/docforce/scanner/index.ts", ["src/docforce/**"]), true);
    assert.equal(isExcluded("src/slack/app.ts", ["src/docforce/**"]), false);
  });

  it("matches nested paths with **", () => {
    assert.equal(isExcluded("src/docforce/model/types.ts", ["src/docforce/**"]), true);
    assert.equal(isExcluded("src/tasks/service.ts", ["src/docforce/**"]), false);
  });

  it("matches directory paths", () => {
    assert.equal(isExcluded("src/docforce", ["src/docforce/**"]), false);
    assert.equal(isExcluded("src/docforce/index.ts", ["src/docforce/**"]), true);
  });

  it("supports multiple patterns", () => {
    const patterns = ["src/docforce/**", "test/**"];
    assert.equal(isExcluded("src/docforce/cli.ts", patterns), true);
    assert.equal(isExcluded("test/helper.ts", patterns), true);
    assert.equal(isExcluded("src/slack/app.ts", patterns), false);
  });

  it("returns false for empty exclusion list", () => {
    assert.equal(isExcluded("src/anything.ts", []), false);
  });
});

describe("Analysis Exclusions", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `docforce-test-excl-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("excluded directories do not appear as components", () => {
    mkdirSync(join(tmpDir, "src", "app"), { recursive: true });
    mkdirSync(join(tmpDir, "src", "tooling"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "app", "index.ts"), "export function main() {}");
    writeFileSync(join(tmpDir, "src", "tooling", "index.ts"), "export function scan() {}");

    const findings = scanSourceImports(tmpDir, ["src/tooling/**"]);
    assert.ok(findings.components.some((c) => c.name === "app"));
    assert.ok(!findings.components.some((c) => c.name === "tooling"));
  });

  it("excluded sources do not contribute integration evidence", () => {
    mkdirSync(join(tmpDir, "src", "scanner"), { recursive: true });
    mkdirSync(join(tmpDir, "src", "app"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "scanner", "detect.ts"),
      'import { App } from "@slack/bolt";\n');
    writeFileSync(join(tmpDir, "src", "app", "main.ts"),
      'import { App } from "@slack/bolt";\n');

    const findings = scanSourceImports(tmpDir, ["src/scanner/**"]);
    const slack = findings.integrations.find((i) => i.name === "Slack (Bolt SDK)");
    assert.ok(slack);
    assert.equal(slack.provenance.evidence[0]!.sourceFile, "src/app/main.ts");
  });

  it("excluded sources do not contribute database import evidence", () => {
    mkdirSync(join(tmpDir, "src", "tooling"), { recursive: true });
    mkdirSync(join(tmpDir, "src", "tasks"), { recursive: true });
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "test" }));
    writeFileSync(join(tmpDir, "src", "tooling", "db.ts"),
      'import { DatabaseSync } from "node:sqlite";\n');
    writeFileSync(join(tmpDir, "src", "tasks", "store.ts"),
      'import { DatabaseSync } from "node:sqlite";\n');

    const findings = scanDatabase(tmpDir, ["src/tooling/**"]);
    const sqlite = findings.datastores.find((d) => d.name.includes("node:sqlite"));
    assert.ok(sqlite);
    const evidenceFiles = sqlite.provenance.evidence.map((e) => e.sourceFile);
    assert.ok(!evidenceFiles.some((f) => f.startsWith("src/tooling/")));
    assert.ok(evidenceFiles.some((f) => f.startsWith("src/tasks/")));
  });
});

describe("Import Statement Detection", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `docforce-test-imports-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects actual import statements", () => {
    mkdirSync(join(tmpDir, "src", "slack"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "slack", "app.ts"),
      'import { App } from "@slack/bolt";\nconst app = new App({});\n');

    const imports = collectImports(join(tmpDir, "src"), tmpDir, []);
    const slackImport = imports.find((i) => i.importedModule === "@slack/bolt");
    assert.ok(slackImport);
    assert.equal(slackImport.sourceFile, "src/slack/app.ts");
    assert.equal(slackImport.kind, "static-import");
    assert.equal(slackImport.isExternal, true);
  });

  it("string literals in lookup tables do NOT count as imports", () => {
    mkdirSync(join(tmpDir, "src", "scanner"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "scanner", "detect.ts"), `
const CATEGORY_MAP: Record<string, string> = {
  "@slack/bolt": "messaging",
  "zod": "validation",
};

export function detect() { return CATEGORY_MAP; }
`);

    const imports = collectImports(join(tmpDir, "src"), tmpDir, []);
    const slackImport = imports.find((i) => i.importedModule === "@slack/bolt");
    assert.equal(slackImport, undefined, "String in lookup table must NOT be detected as import");
  });

  it("scanner file containing @slack/bolt as string does not produce Slack integration", () => {
    mkdirSync(join(tmpDir, "src", "scanner"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "scanner", "packageJson.ts"), `
const TECH_MAP: Record<string, { category: string }> = {
  "@slack/bolt": { category: "messaging" },
};
export function scan() { return TECH_MAP; }
`);

    const findings = scanSourceImports(tmpDir, []);
    const slack = findings.integrations.find((i) => i.name === "Slack (Bolt SDK)");
    assert.equal(slack, undefined, "@slack/bolt in a string literal must not produce an integration");
  });

  it("detects re-export statements", () => {
    mkdirSync(join(tmpDir, "src", "lib"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "lib", "index.ts"),
      'export { something } from "@slack/bolt";\n');

    const imports = collectImports(join(tmpDir, "src"), tmpDir, []);
    const slackImport = imports.find((i) => i.importedModule === "@slack/bolt");
    assert.ok(slackImport);
    assert.equal(slackImport.kind, "re-export");
  });

  it("distinguishes external from internal imports", () => {
    mkdirSync(join(tmpDir, "src", "app"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "app", "main.ts"), `
import { helper } from "./utils.js";
import { App } from "@slack/bolt";
import { readFileSync } from "node:fs";
`);

    const imports = collectImports(join(tmpDir, "src"), tmpDir, []);
    const internal = imports.find((i) => i.importedModule === "./utils.js");
    const external = imports.find((i) => i.importedModule === "@slack/bolt");
    const node = imports.find((i) => i.importedModule === "node:fs");

    assert.ok(internal);
    assert.equal(internal.isExternal, false);
    assert.ok(external);
    assert.equal(external.isExternal, true);
    assert.ok(node);
    assert.equal(node.isExternal, true);
  });

  it("records correct line numbers for imports", () => {
    mkdirSync(join(tmpDir, "src", "app"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "app", "main.ts"), `// comment line 1
// comment line 2
import { App } from "@slack/bolt";
`);

    const imports = collectImports(join(tmpDir, "src"), tmpDir, []);
    const slackImport = imports.find((i) => i.importedModule === "@slack/bolt");
    assert.ok(slackImport);
    assert.equal(slackImport.line, 3);
  });
});

describe("Mermaid Exclusion", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `docforce-test-mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("excluded components produce no Mermaid nodes or edges", async () => {
    const { generateArchitectureDiagram } = await import("../generator/architectureDiagram.js");

    mkdirSync(join(tmpDir, "src", "app"), { recursive: true });
    mkdirSync(join(tmpDir, "src", "lib"), { recursive: true });
    mkdirSync(join(tmpDir, "src", "tooling"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "app", "index.ts"), 'import { helper } from "../lib/utils.js";\nexport function run() {}');
    writeFileSync(join(tmpDir, "src", "lib", "utils.ts"), "export function helper() {}");
    writeFileSync(join(tmpDir, "src", "tooling", "index.ts"), "export function scan() {}");

    const findings = scanSourceImports(tmpDir, ["src/tooling/**"]);

    const model = {
      metadata: {
        schemaVersion: "0.7.0" as const,
        docforceVersion: "0.7.0" as const,
        repositoryName: "test",
        repositoryRoot: tmpDir,
        git: { commitSha: null, branch: null, dirty: null },
        generatedAt: new Date().toISOString(),
        configHash: "test",
      },
      product: { name: "Test", type: "test", description: "Test" },
      runtime: [],
      languages: [],
      technologies: [],
      components: findings.components,
      datastores: [],
      integrations: [],
      infrastructure: [],
      workflows: [],
      relationships: [{
        id: "rel:app:imports:lib",
        from: "app",
        to: "lib",
        type: "imports" as const,
        classification: "observation" as const,
        confidence: "high" as const,
        evidence: [{ sourceFile: "src/app/index.ts", evidenceType: "module-import" }],
      }],
      unknowns: [],
      apiRoutes: [],
      devices: [],
      coverage: {
        typescriptJavascriptRoots: 0,
        pythonRoots: 0,
        apiRoutes: 0,
        composeServices: 0,
        composeVolumes: 0,
        deviceEvidence: 0,
        unsupportedEvidence: [],
      },
    };

    const mmd = generateArchitectureDiagram(model);
    assert.ok(mmd.includes("app"), "app component should be in diagram");
    assert.ok(mmd.includes("lib"), "lib component should be in diagram");
    assert.ok(!mmd.includes("tooling"), "excluded tooling should NOT be in diagram");
  });
});
