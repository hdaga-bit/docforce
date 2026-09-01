import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runAllScanners } from "./index.js";
import type { DocforceConfig } from "../config/types.js";
import { DEFAULT_PR_CONFIG } from "../config/index.js";
import { MODEL_SCHEMA_VERSION } from "../version.js";
import { classifyTechnology } from "../view/classifyTechnology.js";
import { buildSystemModel } from "../model/builder.js";
import { buildDocumentationViewModel } from "../view/buildViewModel.js";
import { validateSystemModel } from "../validator/index.js";
import { generateTechnicalOverview } from "../generator/technicalOverview.js";
import { generateSoftwareArchitecture, generateSystemOverview, generateDeploymentArchitecture } from "../generator/architectureViews.js";
import { generateTechnologyInventory } from "../generator/technologyInventory.js";
import { DEFAULT_DOCS_OUTPUT } from "../config/types.js";

function makeConfig(include: readonly string[], extra?: Partial<DocforceConfig>): DocforceConfig {
  return {
    schemaVersion: "1.0.0",
    product: { name: "Fixture", type: "application", description: "v1.2 fixture" },
    scanning: { rootDir: ".", include: [...include], exclude: extra?.scanning?.exclude ?? [] },
    analysis: { exclude: extra?.analysis?.exclude ?? [] },
    architecture: { components: {} },
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

function composeTwoServices(extraAppEnv = "- SIDECAR_URL=http://sidecar:8080"): string {
  return `version: "2"
services:
  app:
    build: .
    environment:
      ${extraAppEnv}
  sidecar:
    image: example/sidecar:1
    ports:
      - "8080:8080"
`;
}

describe("v1.2 relationship completeness and documentation hygiene", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `docforce-v12-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("environment URL plus HTTP call produces a local-service relationship", () => {
    write(tmpDir, "docker-compose.yml", composeTwoServices());
    write(tmpDir, "app/api/chat/route.ts", `
const SIDECAR_URL = (process.env.SIDECAR_URL || "http://sidecar:8080").replace(/\\/$/, "");
export async function POST() {
  return fetch(\`\${SIDECAR_URL}/v1/chat\`, { method: "POST" });
}
`);
    write(tmpDir, "sidecar/main.py", "print('ok')\n");
    const results = runAllScanners(tmpDir, makeConfig(["app/**", "sidecar/**", "docker-compose.yml"]));
    const rel = results.relationships.find(
      (r) => r.from === "app" && r.to === "infra:sidecar" && r.type === "calls-api",
    );
    assert.ok(rel, "expected app → infra:sidecar calls-api");
    assert.equal(rel.classification, "observation");
    assert.ok(rel.evidence.some((e) => e.evidenceType === "env-url-resolution" || e.evidenceType === "local-service-http"));
    assert.ok(!rel.description || !/healthcare|orchestration/i.test(rel.description));
  });

  it("Compose services without a runtime call do not get a calls-api edge", () => {
    write(tmpDir, "docker-compose.yml", `version: "2"
services:
  app:
    build: .
  idle:
    image: example/idle:1
`);
    write(tmpDir, "app/index.ts", "export const app = true;\n");
    write(tmpDir, "idle/main.py", "print('idle')\n");
    const results = runAllScanners(tmpDir, makeConfig(["app/**", "idle/**", "docker-compose.yml"]));
    const calls = results.relationships.filter(
      (r) => r.type === "calls-api" && (r.to === "infra:idle" || r.to === "idle"),
    );
    assert.equal(calls.length, 0);
  });

  it("depends_on is a deployment relationship, not a software call", () => {
    write(tmpDir, "docker-compose.yml", `version: "2"
services:
  app:
    build: .
  browser:
    build: ./browser
    depends_on:
      - app
`);
    write(tmpDir, "app/index.ts", "export const app = true;\n");
    write(tmpDir, "browser/index.ts", "export const browser = true;\n");
    const results = runAllScanners(tmpDir, makeConfig(["app/**", "browser/**", "docker-compose.yml"]));
    const dep = results.relationships.find(
      (r) => r.from === "infra:browser" && r.to === "infra:app" && r.type === "depends-on",
    );
    assert.ok(dep, "expected infra:browser → infra:app depends-on");
    assert.ok(dep.evidence.some((e) => e.evidenceType === "compose-depends-on" || e.evidenceType === "compose-service"));
    const softwareCall = results.relationships.find(
      (r) => r.from === "browser" && r.to === "app" && (r.type === "calls-api" || r.type === "invokes"),
    );
    assert.equal(softwareCall, undefined);
  });

  it("Firebase collection write evidence produces writes-to", () => {
    write(tmpDir, "package.json", JSON.stringify({
      name: "app",
      dependencies: { firebase: "12.0.0" },
    }));
    write(tmpDir, "lib/store.ts", `
import { getFirestore, collection, doc, setDoc } from "firebase/firestore";
export async function save() {
  const db = getFirestore();
  await setDoc(doc(collection(db, "sessions"), "1"), { ok: true });
}
`);
    const results = runAllScanners(tmpDir, makeConfig(["package.json", "lib/**"]));
    const rel = results.relationships.find(
      (r) => r.from === "lib" && r.to.startsWith("store:") && r.type === "writes-to",
    );
    assert.ok(rel, "expected lib writes-to Firebase");
    assert.ok(rel.evidence.some((e) => /firestore|firebase/i.test(e.evidenceType) || /setDoc|collection/.test(e.detail ?? "")));
  });

  it("SDK installed without an operation does not create a datastore edge", () => {
    write(tmpDir, "package.json", JSON.stringify({
      name: "app",
      dependencies: { firebase: "12.0.0" },
    }));
    write(tmpDir, "lib/index.ts", "export const n = 1;\n");
    const results = runAllScanners(tmpDir, makeConfig(["package.json", "lib/**"]));
    const storeRels = results.relationships.filter(
      (r) => r.to.startsWith("store:") && (r.type === "persists-to" || r.type === "reads-from" || r.type === "writes-to"),
    );
    assert.equal(storeRels.length, 0);
  });

  it("localStorage getItem/setItem become reads-from and writes-to", () => {
    write(tmpDir, "lib/prefs.ts", `
export function load() { return localStorage.getItem("k"); }
export function save(v: string) { localStorage.setItem("k", v); }
`);
    const results = runAllScanners(tmpDir, makeConfig(["lib/**"]));
    assert.ok(results.datastores.some((d) => d.name === "localStorage"));
    assert.ok(results.relationships.some((r) => r.from === "lib" && r.to === "store:localstorage" && r.type === "reads-from"));
    assert.ok(results.relationships.some((r) => r.from === "lib" && r.to === "store:localstorage" && r.type === "writes-to"));
  });

  it("IndexedDB put/get become writes-to and reads-from", () => {
    write(tmpDir, "lib/idb.ts", `
export async function openDb() {
  const req = indexedDB.open("queue", 1);
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction("items", "readwrite");
    tx.objectStore("items").put({ id: 1 });
    tx.objectStore("items").get(1);
  };
}
`);
    const results = runAllScanners(tmpDir, makeConfig(["lib/**"]));
    assert.ok(results.datastores.some((d) => d.name === "IndexedDB"));
    assert.ok(results.relationships.some((r) => r.from === "lib" && r.to === "store:indexeddb" && r.type === "writes-to"));
    assert.ok(results.relationships.some((r) => r.from === "lib" && r.to === "store:indexeddb" && r.type === "reads-from"));
  });

  it("named Firestore database id is metadata on the single Firebase datastore", () => {
    write(tmpDir, "package.json", JSON.stringify({
      name: "app",
      dependencies: { "firebase-admin": "13.0.0" },
    }));
    write(tmpDir, "lib/server/db.ts", `
import { getFirestore } from "firebase-admin/firestore";
const FIRESTORE_DB_ID = "patdb";
export function db(app: object) {
  return getFirestore(app as never, FIRESTORE_DB_ID);
}
`);
    const results = runAllScanners(tmpDir, makeConfig(["package.json", "lib/**"]));
    const firebase = results.datastores.filter((d) => /firebase|firestore/i.test(`${d.name} ${d.engine ?? ""}`));
    assert.equal(firebase.length, 1);
    assert.equal(firebase[0]!.location, "patdb");
  });

  it("source usage elevates a devDependency presentation class", () => {
    write(tmpDir, "package.json", JSON.stringify({
      name: "app",
      devDependencies: { "firebase-admin": "13.0.0" },
    }));
    write(tmpDir, "lib/server/admin.ts", `
import { getFirestore } from "firebase-admin/firestore";
export function db() { return getFirestore(); }
`);
    const config = makeConfig(["package.json", "lib/**"]);
    const results = runAllScanners(tmpDir, config);
    const model = buildSystemModel(tmpDir, join(tmpDir, "docforce.yml"), config, results);
    const tech = model.technologies.find((t) => t.name === "firebase-admin");
    assert.ok(tech);
    const view = classifyTechnology(tech, model, config);
    assert.notEqual(view.presentation, "development-tool");
  });

  it("scoped payment, validation, chart, animation, and analytics families classify generically", () => {
    write(tmpDir, "package.json", JSON.stringify({
      name: "app",
      dependencies: {
        "@paystack/inline-js": "2.0.0",
        zod: "3.25.0",
        recharts: "2.15.0",
        "framer-motion": "12.0.0",
        "@vercel/analytics": "1.3.0",
      },
    }));
    const config = makeConfig(["package.json"]);
    const results = runAllScanners(tmpDir, config);
    const model = buildSystemModel(tmpDir, join(tmpDir, "docforce.yml"), config, results);
    const presentation = (name: string) => classifyTechnology(
      model.technologies.find((t) => t.name === name)!,
      model,
      config,
    ).presentation;
    assert.equal(presentation("@paystack/inline-js"), "capability-library");
    assert.equal(presentation("zod"), "capability-library");
    assert.equal(presentation("recharts"), "capability-library");
    assert.equal(presentation("framer-motion"), "supporting-library");
    assert.equal(presentation("@vercel/analytics"), "capability-library");
  });

  it("Python audio/AI libraries classify as capability libraries when family evidence exists", () => {
    write(tmpDir, "gateway/requirements.txt", "litert-lm-api==0.13.1\nsoundfile\nkokoro-onnx\n");
    write(tmpDir, "gateway/server.py", "print('ok')\n");
    const config = makeConfig(["gateway/**"]);
    const results = runAllScanners(tmpDir, config);
    const model = buildSystemModel(tmpDir, join(tmpDir, "docforce.yml"), config, results);
    for (const name of ["litert-lm-api", "soundfile", "kokoro-onnx"]) {
      const tech = model.technologies.find((t) => t.name === name);
      assert.ok(tech, name);
      assert.equal(classifyTechnology(tech, model, config).presentation, "capability-library", name);
    }
  });

  it("system overview keeps software identity when a compose service shares the name", () => {
    write(tmpDir, "docker-compose.yml", composeTwoServices());
    write(tmpDir, "balena.yml", "name: example-fleet\ntype: sw.application\n");
    write(tmpDir, "app/page.tsx", "export default function Page() { return null; }\n");
    write(tmpDir, "lib/util.ts", "export const n = 1;\n");
    write(tmpDir, "sidecar/main.py", "print('ok')\n");
    const config = makeConfig(["app/**", "lib/**", "sidecar/**", "docker-compose.yml", "balena.yml"]);
    const results = runAllScanners(tmpDir, config);
    const model = buildSystemModel(tmpDir, join(tmpDir, "docforce.yml"), config, results);
    const view = buildDocumentationViewModel(model, config);
    const software = view.overviewNodes.filter((n) => n.category === "application-software");
    const services = view.overviewNodes.filter((n) => n.category === "local-services");
    assert.ok(software.some((n) => n.entityId === "app"), "software component app stays in Application");
    assert.ok(software.some((n) => n.entityId === "lib"));
    assert.ok(services.some((n) => n.entityId === "infra:sidecar"));
    const appService = services.find((n) => n.entityId === "infra:app");
    if (appService) {
      assert.notEqual(appService.label, "app", "service label must not collide with software label");
    }
    assert.ok(
      !view.overviewNodes.some((n) => n.entityId.startsWith("dsvc:") && (n.label === "app" || n.label === "sidecar")),
      "compose services must not also appear as device-service overview nodes",
    );
    const diagram = generateSystemOverview(model, config);
    assert.ok(diagram.includes("Application / Software"));
    assert.match(diagram, /subgraph Application \/ Software[\s\S]*app/);
    const deploy = generateDeploymentArchitecture(model, config);
    assert.ok(deploy.includes("subgraph Software"));
    assert.ok(deploy.includes("subgraph Services"));
    assert.doesNotMatch(deploy, /(\w+) -- "deploys" --> \1/);
    assert.ok(deploy.includes("app service") || deploy.includes("deploys"));
  });

  it("technical overview summarizes environment variables instead of dumping them", () => {
    const envLines = Array.from({ length: 18 }, (_, i) => `      - VAR_${i}=value${i}`).join("\n");
    write(tmpDir, "docker-compose.yml", `version: "2"
services:
  app:
    build: .
    environment:
${envLines}
`);
    write(tmpDir, "app/index.ts", "export const app = true;\n");
    const config = makeConfig(["app/**", "docker-compose.yml"]);
    const results = runAllScanners(tmpDir, config);
    const model = buildSystemModel(tmpDir, join(tmpDir, "docforce.yml"), config, results);
    const overview = generateTechnicalOverview(model, config);
    assert.ok(!overview.includes("VAR_0=value0"));
    assert.ok(!overview.includes("VAR_17=value17"));
    assert.match(overview, /18 environment variable/);
    assert.ok(overview.includes("configuration-inventory.md"));
  });

  it("repeated container images are aggregated in high-level documentation", () => {
    write(tmpDir, "Dockerfile.template", "FROM node:20-bookworm\n");
    write(tmpDir, "litert/Dockerfile.template", "FROM node:20-bookworm\n");
    write(tmpDir, "moonshine/Dockerfile.template", "FROM node:20-bookworm-slim\n");
    write(tmpDir, "app/index.ts", "export const app = true;\n");
    const config = makeConfig(["app/**", "Dockerfile.template", "litert/**", "moonshine/**"]);
    const results = runAllScanners(tmpDir, config);
    const model = buildSystemModel(tmpDir, join(tmpDir, "docforce.yml"), config, results);
    const overview = generateTechnicalOverview(model, config);
    const slimCount = (overview.match(/node:20-bookworm-slim/g) ?? []).length;
    const bookwormRows = overview.split("\n").filter((line) => line.includes("node:20-bookworm") && !line.includes("slim"));
    assert.ok(bookwormRows.length <= 2, `expected aggregated bookworm rows, got ${bookwormRows.length}`);
    assert.equal(slimCount, 1);
    assert.match(overview, /used by 2 /);
  });

  it("external integration display labels keep the canonical hostname", () => {
    write(tmpDir, "app/mail.ts", `
export async function send() {
  await fetch("https://api.resend.com/emails", { method: "POST" });
}
`);
    const config = makeConfig(["app/**"]);
    const results = runAllScanners(tmpDir, config);
    const model = buildSystemModel(tmpDir, join(tmpDir, "docforce.yml"), config, results);
    assert.ok(results.integrations.some((i) => i.name === "api.resend.com" || i.name === "Resend API"));
    const overview = generateTechnicalOverview(model, config);
    assert.ok(overview.includes("Resend API"));
    assert.ok(overview.includes("api.resend.com"));
  });

  it("software architecture includes evidenced local-service HTTP edges", () => {
    write(tmpDir, "docker-compose.yml", composeTwoServices());
    write(tmpDir, "app/api/chat/route.ts", `
const SIDECAR_URL = process.env.SIDECAR_URL || "http://sidecar:8080";
export async function POST() {
  return fetch(\`\${SIDECAR_URL}/v1/chat\`);
}
`);
    write(tmpDir, "sidecar/main.py", "print('ok')\n");
    const config = makeConfig(["app/**", "sidecar/**", "docker-compose.yml"]);
    const results = runAllScanners(tmpDir, config);
    const model = buildSystemModel(tmpDir, join(tmpDir, "docforce.yml"), config, results);
    const diagram = generateSoftwareArchitecture(model, config);
    assert.ok(diagram.includes("sidecar"));
    assert.ok(diagram.includes("calls") || diagram.includes("calls-api"));
  });

  it("MaryForce-style src layout does not invent compose HTTP edges", () => {
    write(tmpDir, "src/orchestrator/index.ts", "export const run = () => 1;\n");
    write(tmpDir, "src/slack/app.ts", 'import { run } from "../orchestrator/index.js";\nexport const slack = run;\n');
    const results = runAllScanners(tmpDir, makeConfig(["src/**"]));
    assert.ok(results.components.some((c) => c.id === "orchestrator"));
    assert.ok(results.components.some((c) => c.id === "slack"));
    assert.equal(results.relationships.filter((r) => r.type === "calls-api" && r.to.startsWith("infra:")).length, 0);
    assert.equal(results.relationships.filter((r) => r.from.startsWith("infra:")).length, 0);
  });

  it("PAT-style local sidecar env URL is generic and does not hardcode product names", () => {
    write(tmpDir, "docker-compose.yml", `version: "2"
services:
  app:
    build: .
    environment:
      - LITERT_URL=http://litert:11435
      - MOONSHINE_URL=http://moonshine:11436
  litert:
    build: ./litert
    ports:
      - "11435:11435"
  moonshine:
    build: ./moonshine
    ports:
      - "11436:11436"
`);
    write(tmpDir, "app/api/chat/route.ts", `
const LITERT_URL = (process.env.LITERT_URL || "http://litert:11435").replace(/\\/$/, "");
export async function POST() {
  return fetch(\`\${LITERT_URL}/v1/chat\`, { method: "POST" });
}
`);
    write(tmpDir, "app/api/voice/stt/route.ts", `
const MOONSHINE_URL = (process.env.MOONSHINE_URL || "").replace(/\\/$/, "");
export async function POST() {
  return fetch(\`\${MOONSHINE_URL}/transcribe\`, { method: "POST" });
}
`);
    write(tmpDir, "litert/server.py", "print('llm')\n");
    write(tmpDir, "moonshine/server.py", "print('voice')\n");
    const results = runAllScanners(tmpDir, makeConfig(["app/**", "litert/**", "moonshine/**", "docker-compose.yml"]));
    assert.ok(results.relationships.some((r) => r.from === "app" && r.to === "infra:litert" && r.type === "calls-api"));
    assert.ok(results.relationships.some((r) => r.from === "app" && r.to === "infra:moonshine" && r.type === "calls-api"));
    const validated = validateSystemModel(
      buildSystemModel(tmpDir, join(tmpDir, "docforce.yml"), makeConfig(["app/**", "litert/**", "moonshine/**", "docker-compose.yml"]), results),
    );
    assert.equal(validated.valid, true, validated.errors.map((e) => `${e.path}: ${e.message}`).join("; "));
    const inventory = generateTechnologyInventory(
      buildSystemModel(tmpDir, join(tmpDir, "docforce.yml"), makeConfig(["app/**"]), results),
      makeConfig(["app/**"]),
    );
    assert.ok(!inventory.includes("healthcare orchestration"));
  });

  it("does not bump the public System Model schema version", () => {
    assert.equal(MODEL_SCHEMA_VERSION, "1.0.0");
  });
});
