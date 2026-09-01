import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateTechnicalArchitecture } from "./technicalArchitecture.js";
import { generateAllDocs } from "./index.js";
import {
  generateSystemOverview,
  generateSoftwareArchitecture,
  generateDeploymentArchitecture,
  generateDeviceArchitecture,
} from "./architectureViews.js";
import { generateConfigurationInventory } from "./configurationInventory.js";
import { runAllScanners } from "../scanner/index.js";
import { buildSystemModel } from "../model/builder.js";
import { validateSystemModel } from "../validator/index.js";
import { MODEL_SCHEMA_VERSION } from "../version.js";
import { ARTIFACT_REGISTRY } from "../update/artifactRegistry.js";
import { DOCUMENT_REGISTRY } from "../impact/documentRegistry.js";
import { assessDeterministicDocs } from "../pr/deterministicDocs.js";
import { DEFAULT_DOCS_OUTPUT } from "../config/types.js";
import { DEFAULT_PR_CONFIG } from "../config/index.js";
import type { DocforceConfig } from "../config/types.js";
import type { ChangeImpactReport } from "../impact/types.js";
import type { Provenance, SystemModel } from "../model/types.js";
import { EMPTY_COVERAGE } from "../model/builder.js";

function makeConfig(include: readonly string[], extra?: Partial<DocforceConfig>): DocforceConfig {
  return {
    schemaVersion: "1.0.0",
    product: {
      name: extra?.product?.name ?? "Fixture",
      type: extra?.product?.type ?? "application",
      description: extra?.product?.description ?? "v1.3 fixture",
    },
    scanning: { rootDir: ".", include: [...include], exclude: extra?.scanning?.exclude ?? [] },
    analysis: { exclude: extra?.analysis?.exclude ?? [] },
    architecture: { components: extra?.architecture?.components ?? {} },
    output: {
      systemModel: ".docforce/system-model.json",
      docs: DEFAULT_DOCS_OUTPUT,
    },
    documentation: { allowedRoots: ["docs/"], aiAssisted: [] },
    ai: {},
    pr: DEFAULT_PR_CONFIG,
    ...extra,
  };
}

function write(dir: string, rel: string, content: string): void {
  const full = join(dir, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

function prov(sourceFile = "package.json"): Provenance {
  return { kind: "observation", confidence: "high", evidence: [{ sourceFile, evidenceType: "dependency" }] };
}

function impactReport(affected: readonly string[]): ChangeImpactReport {
  return {
    baseRef: "HEAD",
    headRef: "HEAD",
    generatedAt: "2026-09-01T00:00:00.000Z",
    docforceVersion: "1.3.0",
    fileChanges: [],
    modelDelta: { entityChanges: [], relationshipChanges: [], changedDomains: new Set(), isEmpty: true },
    overallImpactLevel: "high",
    manualReviewRecommended: false,
    documentImpacts: ARTIFACT_REGISTRY.map((artifact) => ({
      artifact: artifact.id,
      affected: affected.includes(artifact.id),
      impactLevel: affected.includes(artifact.id) ? "high" : "none",
      reason: "test",
      triggeringDomains: ["components"],
    })),
    unknowns: [],
  };
}

function patStyleFixture(dir: string): DocforceConfig {
  write(dir, "docker-compose.yml", `version: "2"
services:
  app:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - relay-journal:/journal
    environment:
      - LITERT_URL=http://litert:11435
      - MOONSHINE_URL=http://moonshine:11436
      - ASKMARY_API_KEY
  litert:
    build: ./litert
    ports:
      - "11435:11435"
    volumes:
      - litert-model:/models
  moonshine:
    build: ./moonshine
    ports:
      - "11436:11436"
  browser:
    build: ./browser
    depends_on:
      - app
    volumes:
      - chromium-profile:/root/.config/chromium
    environment:
      - KIOSK_ALSA_CARD
      - KIOSK_MIC_WATCHDOG=1
      - BOOT_WATCHDOG_INTERVAL_SEC=20
volumes:
  litert-model:
  chromium-profile:
  relay-journal:
`);
  write(dir, "balena.yml", "name: example-fleet\ntype: sw.application\n");
  write(dir, "package.json", JSON.stringify({
    name: "fixture",
    dependencies: {
      next: "16.0.0",
      react: "19.0.0",
      firebase: "12.0.0",
      "@paystack/inline-js": "2.0.0",
      zod: "3.25.0",
      clsx: "2.1.1",
    },
  }));
  write(dir, "app/api/chat/route.ts", `
const LITERT_URL = (process.env.LITERT_URL || "http://litert:11435").replace(/\\/$/, "");
export async function GET() {
  return fetch(\`\${LITERT_URL}/ready\`);
}
export async function POST() {
  return fetch(\`\${LITERT_URL}/v1/chat\`, { method: "POST" });
}
`);
  write(dir, "app/api/voice/stt/route.ts", `
const MOONSHINE_URL = (process.env.MOONSHINE_URL || "http://moonshine:11436").replace(/\\/$/, "");
export async function POST() {
  return fetch(\`\${MOONSHINE_URL}/transcribe\`, { method: "POST" });
}
`);
  write(dir, "app/api/upload-report/route.ts", `
export async function POST() {
  await fetch("https://catbox.moe/user/api.php", { method: "POST" });
  await fetch("https://0x0.st", { method: "POST" });
  await fetch("https://file.io", { method: "POST" });
  await fetch("https://tmpfiles.org/api/v1/upload", { method: "POST" });
}
`);
  write(dir, "app/api/send-report-email/route.ts", `
export async function POST() {
  await fetch("https://api.resend.com/emails", { method: "POST" });
  await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST" });
}
`);
  write(dir, "lib/store.ts", `
import { getFirestore, collection, doc, setDoc, getDoc } from "firebase/firestore";
export async function save() {
  const db = getFirestore();
  await setDoc(doc(collection(db, "sessions"), "1"), { ok: true });
}
export async function load() {
  const db = getFirestore();
  return getDoc(doc(collection(db, "sessions"), "1"));
}
`);
  write(dir, "litert/server.py", "print('llm')\n");
  write(dir, "moonshine/server.py", "print('voice')\n");
  write(dir, "browser/main.py", "print('kiosk')\n");
  return makeConfig(
    ["app/**", "lib/**", "litert/**", "moonshine/**", "browser/**", "docker-compose.yml", "balena.yml", "package.json"],
    { product: { name: "PATFixture", type: "kiosk-application", description: "Self-service kiosk fixture." } },
  );
}

function analyze(dir: string, config: DocforceConfig) {
  const results = runAllScanners(dir, config);
  const model = buildSystemModel(dir, join(dir, "docforce.yml"), config, results);
  return { results, model, config };
}

describe("v1.3 professional technical architecture composer", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `docforce-v13-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("A. flagship document uses the professional conditional structure", () => {
    const config = patStyleFixture(tmpDir);
    const { model } = analyze(tmpDir, config);
    const doc = generateTechnicalArchitecture(model, config);
    for (const heading of [
      "## Executive Technical Summary",
      "## System Context",
      "## Architecture Overview",
      "## Software Architecture",
      "## Technology Stack",
      "## Local API Architecture",
      "## Data Architecture",
      "## External Integrations",
      "## Device & Peripheral Architecture",
      "## Deployment Architecture",
      "## Runtime Configuration",
      "## Documentation Coverage",
      "## Known Technical Gaps / Unknowns",
      "## Appendices / Supporting Artifacts",
    ]) {
      assert.ok(doc.includes(heading), `missing ${heading}`);
    }
    assert.ok(!doc.includes("## Why") && !doc.includes("Architecture Decision"));
  });

  it("B. omits sections the model cannot support", () => {
    const config = makeConfig(["src/**"], {
      product: { name: "MaryLike", type: "service", description: "Orchestrator fixture." },
    });
    write(tmpDir, "src/orchestrator/index.ts", "export const run = () => 1;\n");
    write(tmpDir, "package.json", JSON.stringify({ name: "marylike", dependencies: { zod: "4.0.0" } }));
    const { model } = analyze(tmpDir, makeConfig(["src/**", "package.json"], {
      product: { name: "MaryLike", type: "service", description: "Orchestrator fixture." },
    }));
    const doc = generateTechnicalArchitecture(model, config);
    assert.ok(doc.includes("## Executive Technical Summary"));
    assert.ok(!doc.includes("## Local API Architecture"));
    assert.ok(!doc.includes("## Device & Peripheral Architecture"));
  });

  it("C. technology stack emphasizes major layers and not supporting packages", () => {
    const config = patStyleFixture(tmpDir);
    const { model } = analyze(tmpDir, config);
    const doc = generateTechnicalArchitecture(model, config);
    const stack = doc.slice(doc.indexOf("## Technology Stack"), doc.indexOf("## Local API Architecture"));
    assert.ok(stack.includes("next") || stack.includes("Next"));
    assert.ok(stack.includes("zod"));
    assert.ok(!stack.includes("clsx"));
    assert.ok(doc.includes("technology-inventory.md"));
  });

  it("D. software architecture includes deterministic component summaries", () => {
    const config = patStyleFixture(tmpDir);
    const { model } = analyze(tmpDir, config);
    const doc = generateTechnicalArchitecture(model, config);
    assert.match(doc, /Hosts \d+ App Router API route/);
    assert.ok(!/healthcare orchestration/i.test(doc));
  });

  it("E. local-service HTTP relationships appear in prose", () => {
    const config = patStyleFixture(tmpDir);
    const { model } = analyze(tmpDir, config);
    const doc = generateTechnicalArchitecture(model, config);
    assert.match(doc, /calls[\s\S]{0,80}litert/i);
    assert.match(doc, /calls[\s\S]{0,80}moonshine/i);
    assert.ok(doc.includes("/v1/chat") || doc.includes("`/v1/chat`"));
  });

  it("F. API summary does not dump every route row", () => {
    const config = patStyleFixture(tmpDir);
    const { model } = analyze(tmpDir, config);
    const doc = generateTechnicalArchitecture(model, config);
    const api = doc.slice(doc.indexOf("## Local API Architecture"), doc.indexOf("## Data Architecture"));
    assert.match(api, /\d+ local API routes/i);
    assert.ok(api.includes("chat"));
    assert.ok(!api.includes("`/api/voice/stt`") || api.split("/api/").length <= 6);
    assert.ok(doc.includes("api-inventory.md"));
  });

  it("G. data architecture states evidenced reads and writes", () => {
    const config = patStyleFixture(tmpDir);
    const { model } = analyze(tmpDir, config);
    const doc = generateTechnicalArchitecture(model, config);
    assert.match(doc, /writes to Firebase/i);
    assert.ok(doc.includes("data-architecture.mmd"));
  });

  it("H/I. deployment maps services, named volumes, and mounts", () => {
    const config = patStyleFixture(tmpDir);
    const { results, model } = analyze(tmpDir, config);
    const mount = results.relationships.find(
      (r) => r.type === "mounts" && r.from === "infra:litert" && r.to === "infra:litert-model",
    );
    assert.ok(mount, "expected litert mounts litert-model");
    assert.ok(mount.evidence.some((e) => /\/models/.test(e.detail ?? "")));
    const doc = generateTechnicalArchitecture(model, config);
    assert.ok(doc.includes("litert-model"));
    assert.ok(doc.includes("/models"));
    const deploy = generateDeploymentArchitecture(model, config);
    assert.ok(deploy.includes("mounts") || deploy.includes("/models"));
  });

  it("J. device view does not peer Compose services as device-services", () => {
    const config = patStyleFixture(tmpDir);
    const { model } = analyze(tmpDir, config);
    const device = generateDeviceArchitecture(model, config);
    assert.ok(!device.includes("subgraph Device Services"));
    const doc = generateTechnicalArchitecture(model, config);
    assert.ok(!/## Device[\s\S]*\| litert \| device-service \|/.test(doc));
  });

  it("K. high-level diagrams group file-host integrations", () => {
    const config = patStyleFixture(tmpDir);
    const { model } = analyze(tmpDir, config);
    const overview = generateSystemOverview(model, config);
    const fileHosts = ["catbox.moe", "0x0.st", "file.io", "tmpfiles.org"];
    const listed = fileHosts.filter((host) => overview.includes(host)).length;
    assert.ok(listed < 4, "overview should collapse file-host endpoints");
    assert.match(overview, /File-host/i);
    const software = generateSoftwareArchitecture(model, config);
    assert.ok((software.match(/\/api\//g) ?? []).length <= 2);
    assert.match(software, /routes/);
  });

  it("L. configuration summary uses categories rather than a full dump", () => {
    const config = patStyleFixture(tmpDir);
    const { model } = analyze(tmpDir, config);
    const doc = generateTechnicalArchitecture(model, config);
    const cfg = doc.slice(doc.indexOf("## Runtime Configuration"), doc.indexOf("## Documentation Coverage"));
    assert.ok(/watchdog|audio|credentials|service/i.test(cfg));
    assert.ok(!cfg.includes("ASKMARY_API_KEY") || cfg.length < 1200);
    assert.ok(doc.includes("configuration-inventory.md"));
    const inventory = generateConfigurationInventory(model, config);
    assert.ok(inventory.includes("### ") || inventory.includes("watchdog") || inventory.includes("audio"));
  });

  it("M. does not fabricate architecture rationale", () => {
    const config = patStyleFixture(tmpDir);
    const { model } = analyze(tmpDir, config);
    const doc = generateTechnicalArchitecture(model, config);
    assert.ok(doc.includes("Architecture selection rationale is not currently available as structured, validated repository evidence."));
    assert.ok(!/chosen because|industry standard|best practice/i.test(doc));
    assert.ok(!/why Firebase|why Next\.js|why Balena/i.test(doc));
  });

  it("N. flagship document is deterministic and omits operational provenance", () => {
    const config = patStyleFixture(tmpDir);
    const { model } = analyze(tmpDir, config);
    const a = generateTechnicalArchitecture(model, config);
    const b = generateTechnicalArchitecture(model, config);
    assert.equal(a, b);
    assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(a));
    assert.ok(!/docforceVersion|1\.3\.0/.test(a) || !a.includes(model.metadata.git.commitSha ?? "___"));
    assert.ok(!a.includes(model.metadata.generatedAt));
    if (model.metadata.git.commitSha) assert.ok(!a.includes(model.metadata.git.commitSha));
  });

  it("O. artifact registry and generateAllDocs include the flagship document", () => {
    const config = patStyleFixture(tmpDir);
    const { model } = analyze(tmpDir, config);
    assert.ok(ARTIFACT_REGISTRY.some((a) => a.id === "technical-architecture.md"));
    assert.ok(DOCUMENT_REGISTRY.some((a) => a.artifact === "technical-architecture.md"));
    const result = generateAllDocs(tmpDir, config, model);
    assert.ok(result.files.some((f) => f.path.endsWith("technical-architecture.md") && f.bytes > 0));
  });

  it("P. PR currency detects a missing flagship artifact as stale", () => {
    const config = patStyleFixture(tmpDir);
    const { model } = analyze(tmpDir, config);
    const assessment = assessDeterministicDocs({
      config,
      headModel: model,
      impactReport: impactReport(["technical-architecture.md"]),
      readArtifact: () => undefined,
    });
    const flagship = assessment.artifacts.find((a) => a.artifact === "technical-architecture.md");
    assert.equal(flagship?.status, "missing");
  });

  it("Q. MaryForce-style fixture composes without PAT section assumptions", () => {
    write(tmpDir, "src/orchestrator/index.ts", "export const run = () => 1;\n");
    write(tmpDir, "src/slack/app.ts", 'import { run } from "../orchestrator/index.js";\nexport const slack = run;\n');
    write(tmpDir, "package.json", JSON.stringify({
      name: "maryforce",
      dependencies: { "@slack/bolt": "5.0.0", zod: "4.4.3" },
    }));
    write(tmpDir, "maryforce.service", `[Unit]
Description=MaryForce
After=docker.service
Requires=docker.service
[Service]
ExecStart=/usr/bin/npm start
`);
    const config = makeConfig(["src/**", "package.json", "maryforce.service"], {
      product: { name: "MaryForce", type: "ai-engineering-platform", description: "Slack-to-Claude orchestrator." },
    });
    const { model } = analyze(tmpDir, config);
    const doc = generateTechnicalArchitecture(model, config);
    assert.ok(doc.includes("MaryForce"));
    assert.ok(doc.includes("## Deployment Architecture"));
    assert.ok(!doc.includes("kiosk"));
    assert.ok(!doc.includes("## Device & Peripheral Architecture"));
    assert.equal(model.relationships.filter((r) => r.type === "mounts").length, 0);
  });

  it("R. PAT-style fixture keeps software identity distinct from Compose services", () => {
    const config = patStyleFixture(tmpDir);
    const { model } = analyze(tmpDir, config);
    const doc = generateTechnicalArchitecture(model, config);
    assert.ok(doc.includes("`app`") || doc.includes("app"));
    assert.match(doc, /Compose service/);
    const overview = generateSystemOverview(model, config);
    assert.match(overview, /subgraph Application \/ Software[\s\S]*app/);
    assert.ok(overview.includes("app service") || overview.includes("litert service"));
    const fleetHits = (overview.match(/example-fleet/g) ?? []).length;
    assert.ok(fleetHits <= 1, "fleet target should appear once in the high-level overview");
  });

  it("S. deploys/runs-on inferences carry valid derivedFrom or are observations", () => {
    const config = patStyleFixture(tmpDir);
    const { results, model } = analyze(tmpDir, config);
    const validated = validateSystemModel(model);
    assert.equal(validated.valid, true, validated.errors.map((e) => e.message).join("; "));
    const provenanceWarnings = validated.warnings.filter((w) => /derivedFrom/.test(w.message));
    assert.equal(provenanceWarnings.length, 0, provenanceWarnings.map((w) => w.message).join("; "));
    const mapping = results.relationships.filter((r) => r.type === "deploys" || r.type === "runs-on");
    for (const rel of mapping) {
      if (rel.classification === "inference") {
        assert.ok(rel.derivedFrom && rel.derivedFrom.length > 0, rel.id);
      }
    }
  });

  it("optional HTTP path evidence does not replace the relationship", () => {
    const config = patStyleFixture(tmpDir);
    const { results } = analyze(tmpDir, config);
    const rel = results.relationships.find((r) => r.from === "app" && r.to === "infra:litert");
    assert.ok(rel);
    assert.ok(rel.evidence.some((e) => (e.detail ?? "").includes("/v1/chat")));
    assert.ok(rel.evidence.some((e) => (e.detail ?? "").includes("/ready")));
  });

  it("does not bump the public System Model schema version", () => {
    assert.equal(MODEL_SCHEMA_VERSION, "1.0.0");
  });
});

describe("v1.3 empty-model composer", () => {
  it("still emits a deterministic document for a product-only model", () => {
    const model: SystemModel = {
      metadata: {
        schemaVersion: "1.0.0",
        docforceVersion: "1.3.0",
        repositoryName: "empty",
        repositoryRoot: "/tmp/empty",
        git: { commitSha: "abc", branch: "main", dirty: false },
        generatedAt: "2026-09-01T00:00:00.000Z",
        configHash: "deadbeef",
      },
      product: { name: "Empty", type: "library", description: "No extra evidence." },
      runtime: [],
      languages: [],
      technologies: [],
      components: [],
      datastores: [],
      integrations: [],
      infrastructure: [],
      workflows: [],
      relationships: [],
      unknowns: [],
      apiRoutes: [],
      devices: [],
      coverage: EMPTY_COVERAGE,
    };
    const config = makeConfig([]);
    const doc = generateTechnicalArchitecture(model, config);
    assert.ok(doc.includes("## Executive Technical Summary"));
    assert.ok(doc.includes("## System Context"));
    assert.ok(!doc.includes("abc"));
    assert.ok(!doc.includes("2026-09-01"));
  });
});
