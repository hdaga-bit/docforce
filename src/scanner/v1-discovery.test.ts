import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runAllScanners } from "./index.js";
import { generateArchitectureOverview, generateDependencyGraph } from "../generator/architectureDiagram.js";
import type { DocforceConfig } from "../config/types.js";
import { DEFAULT_PR_CONFIG } from "../config/index.js";
import { buildSystemModel } from "../model/builder.js";

function makeConfig(include: readonly string[], extra?: Partial<DocforceConfig>): DocforceConfig {
  return {
    schemaVersion: "1.0.0",
    product: { name: "Fixture", type: "application", description: "v1 fixture" },
    scanning: { rootDir: ".", include: [...include], exclude: extra?.scanning?.exclude ?? [] },
    analysis: { exclude: extra?.analysis?.exclude ?? [] },
    architecture: { components: {} },
    output: {
      systemModel: ".docforce/system-model.json",
      docs: {
        technicalOverview: "docs/generated/technical-overview.md",
        technologyInventory: "docs/generated/technology-inventory.md",
        architectureDiagram: "docs/generated/architecture.mmd",
        dependencyGraph: "docs/generated/dependency-graph.mmd",
        architectureEvidence: "docs/generated/architecture-evidence.md",
      },
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

describe("v1.0 multi-root and device-aware discovery", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `docforce-v1-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("A. discovers Next.js App Router repositories with no src/", () => {
    write(tmpDir, "app/page.tsx", "export default function Page() { return null; }\n");
    write(tmpDir, "app/layout.tsx", "export default function Layout({ children }: { children: React.ReactNode }) { return children; }\n");
    write(tmpDir, "app/api/health/route.ts", "export async function GET() { return Response.json({ ok: true }); }\n");
    write(tmpDir, "lib/util.ts", "export const n = 1;\n");
    const config = makeConfig(["app/**", "lib/**"]);
    const results = runAllScanners(tmpDir, config);
    assert.ok(results.components.some((c) => c.id === "app"));
    assert.ok(results.components.some((c) => c.id === "lib"));
    assert.ok(!results.components.some((c) => c.id === "health"));
    assert.equal(results.apiRoutes.length, 1);
    assert.equal(results.apiRoutes[0]!.path, "/api/health");
    assert.ok(results.apiRoutes[0]!.methods.includes("GET"));
    assert.equal(results.apiRoutes[0]!.sourceFile, "app/api/health/route.ts");
  });

  it("B. builds import relationships across configured TypeScript roots", () => {
    write(tmpDir, "app/page.ts", 'import { helper } from "../lib/helper.js";\nexport const p = helper;\n');
    write(tmpDir, "lib/helper.ts", "export const helper = 1;\n");
    const config = makeConfig(["app/**", "lib/**"]);
    const results = runAllScanners(tmpDir, config);
    const rel = results.relationships.find((r) => r.from === "app" && r.to === "lib" && r.type === "imports");
    assert.ok(rel);
    assert.equal(rel.classification, "observation");
  });

  it("C. detects Python services and requirements.txt", () => {
    write(tmpDir, "gateway/server.py", "import os\nfrom flask import Flask\napp = Flask(__name__)\n");
    write(tmpDir, "gateway/requirements.txt", "flask==3.0.0\nlitert-lm-api>=0.1\n");
    const config = makeConfig(["gateway/**"]);
    const results = runAllScanners(tmpDir, config);
    assert.ok(results.components.some((c) => c.id === "gateway"));
    assert.ok(results.languages.some((l) => l.name === "Python"));
    assert.ok(results.technologies.some((t) => t.name === "flask" && t.version === "3.0.0"));
    assert.ok(results.technologies.some((t) => t.name === "litert-lm-api"));
  });

  it("D. represents JS/TS and Python sidecars in one repository", () => {
    write(tmpDir, "app/index.ts", "export const app = true;\n");
    write(tmpDir, "sidecar/main.py", "print('ok')\n");
    const config = makeConfig(["app/**", "sidecar/**"]);
    const results = runAllScanners(tmpDir, config);
    assert.ok(results.components.some((c) => c.id === "app"));
    assert.ok(results.components.some((c) => c.id === "sidecar"));
    assert.ok(results.languages.some((l) => l.name === "Python"));
  });

  it("E. distinguishes compose services from named volumes", () => {
    write(tmpDir, "docker-compose.yml", `version: "2"
services:
  app:
    build: .
  worker:
    image: example/worker:1
volumes:
  data-vol:
  cache-vol:
`);
    const config = makeConfig(["docker-compose.yml"]);
    const results = runAllScanners(tmpDir, config);
    const services = results.infrastructure.filter((i) => i.type === "docker-service");
    const volumes = results.infrastructure.filter((i) => i.type === "docker-volume");
    assert.deepEqual(services.map((s) => s.name).sort(), ["app", "worker"]);
    assert.deepEqual(volumes.map((v) => v.name).sort(), ["cache-vol", "data-vol"]);
    assert.ok(!services.some((s) => s.name === "data-vol"));
  });

  it("F. discovers Dockerfile.template files", () => {
    write(tmpDir, "Dockerfile.template", "FROM node:20-bookworm\nEXPOSE 3000\n");
    const config = makeConfig(["Dockerfile.template"]);
    const results = runAllScanners(tmpDir, config);
    assert.ok(results.technologies.some((t) => t.name === "Docker"));
    assert.ok(results.infrastructure.some((i) => i.type === "container-image" && i.name.includes("node:20")));
    assert.ok(results.infrastructure.some((i) => i.type === "exposed-port"));
  });

  it("G. detects Balena fleet config without calling it a Raspberry Pi", () => {
    write(tmpDir, "balena.yml", "name: example-kiosk\ntype: sw.application\n");
    write(tmpDir, "docker-compose.yml", `services:
  app:
    build:
      dockerfile: Dockerfile.template
`);
    write(tmpDir, "Dockerfile.template", "FROM balenalib/%%BALENA_MACHINE_NAME%%-debian:bookworm-run\n");
    const config = makeConfig(["balena.yml", "docker-compose.yml", "Dockerfile.template"]);
    const results = runAllScanners(tmpDir, config);
    assert.ok(results.infrastructure.some((i) => i.type === "device-fleet" || i.name.toLowerCase().includes("balena")));
    assert.ok(results.devices.some((d) => d.kind === "device"));
    assert.ok(!results.devices.some((d) => /raspberry/i.test(d.name)));
    assert.ok(!results.infrastructure.some((i) => /raspberry pi/i.test(i.name)));
  });

  it("H. records Web Serial as a serial communication interface", () => {
    write(tmpDir, "lib/serial.ts", `
export function supported() {
  return typeof navigator !== "undefined" && "serial" in navigator;
}
export async function open() {
  return navigator.serial.requestPort();
}
`);
    const config = makeConfig(["lib/**"]);
    const results = runAllScanners(tmpDir, config);
    const serial = results.devices.find((d) => d.kind === "communication-interface");
    assert.ok(serial);
    assert.match(serial.name, /serial/i);
    assert.ok(serial.provenance.evidence.some((e) => e.evidenceType === "web-serial-api"));
  });

  it("I. records USB printer device-path evidence as a peripheral", () => {
    write(tmpDir, "lib/print.ts", `
const CANDIDATES = ["/dev/usb/lp0", "/dev/usb/lp1"];
export function findPrinterDevice(): string | null { return CANDIDATES[0] ?? null; }
`);
    const config = makeConfig(["lib/**"]);
    const results = runAllScanners(tmpDir, config);
    const printer = results.devices.find((d) => d.kind === "peripheral");
    assert.ok(printer);
    assert.ok(printer.provenance.evidence.some((e) => e.evidenceType === "usb-device-path"));
  });

  it("J. records getUserMedia camera and microphone peripherals", () => {
    write(tmpDir, "lib/media.ts", `
export async function camera() {
  return navigator.mediaDevices.getUserMedia({ video: true });
}
export async function mic() {
  return navigator.mediaDevices.getUserMedia({ audio: true });
}
`);
    const config = makeConfig(["lib/**"]);
    const results = runAllScanners(tmpDir, config);
    const kinds = results.devices.filter((d) => d.kind === "peripheral").map((d) => d.name.toLowerCase());
    assert.ok(kinds.some((n) => n.includes("camera") || n.includes("video")));
    assert.ok(kinds.some((n) => n.includes("mic") || n.includes("audio")));
    assert.ok(results.devices.some((d) => d.provenance.evidence.some((e) => e.evidenceType === "media-device-api")));
  });

  it("K. detects IndexedDB and localStorage as browser datastores", () => {
    write(tmpDir, "lib/store.ts", `
export function save(key: string, value: string) {
  localStorage.setItem(key, value);
  const req = indexedDB.open("queue");
  return req;
}
`);
    const config = makeConfig(["lib/**"]);
    const results = runAllScanners(tmpDir, config);
    assert.ok(results.datastores.some((d) => /localstorage/i.test(d.name) || d.type === "browser-storage"));
    assert.ok(results.datastores.some((d) => /indexeddb/i.test(d.name) || d.engine === "IndexedDB"));
  });

  it("L. detects generic HTTP APIs from fetch and same-file constants", () => {
    write(tmpDir, "lib/client.ts", `
const PAYMENTS_API = "https://api.example-payments.test/v1";
export function charge() {
  return fetch(\`\${PAYMENTS_API}/charges\`);
}
export function doctors() {
  return fetch("https://clinic.example.test/doctors");
}
`);
    const config = makeConfig(["lib/**"]);
    const results = runAllScanners(tmpDir, config);
    assert.ok(results.integrations.some((i) => i.name.includes("example-payments.test") || i.name.includes("api.example-payments.test")));
    assert.ok(results.integrations.some((i) => i.name.includes("clinic.example.test")));
    assert.ok(!results.integrations.some((i) => /paystack/i.test(i.name)));
  });

  it("M. ignores source roots outside scanning.include", () => {
    write(tmpDir, "app/index.ts", "export const app = 1;\n");
    write(tmpDir, "secret/hidden.ts", 'import { App } from "@slack/bolt";\nexport const x = App;\n');
    const config = makeConfig(["app/**"]);
    const results = runAllScanners(tmpDir, config);
    assert.ok(results.components.some((c) => c.id === "app"));
    assert.ok(!results.components.some((c) => c.id === "secret"));
    assert.ok(!results.integrations.some((i) => i.name.includes("Slack")));
  });

  it("N. exclusions override include", () => {
    write(tmpDir, "app/index.ts", "export const app = 1;\n");
    write(tmpDir, "vendor/pkg/index.ts", "export const vendored = 1;\n");
    const config = makeConfig(["app/**", "vendor/**"], {
      scanning: { rootDir: ".", include: ["app/**", "vendor/**"], exclude: ["vendor/**"] },
      analysis: { exclude: ["vendor/**"] },
    });
    const results = runAllScanners(tmpDir, config);
    assert.ok(results.components.some((c) => c.id === "app"));
    assert.ok(!results.components.some((c) => c.id === "vendor" || c.id === "pkg"));
  });

  it("O. duplicate include patterns do not duplicate evidence", () => {
    write(tmpDir, "lib/a.ts", "export const a = 1;\n");
    const config = makeConfig(["lib/**", "lib/**", "lib/**"]);
    const results = runAllScanners(tmpDir, config);
    assert.equal(results.components.filter((c) => c.id === "lib").length, 1);
  });

  it("P. the same repository scan is deterministic", () => {
    write(tmpDir, "app/index.ts", "export const app = 1;\n");
    write(tmpDir, "lib/index.ts", "export const lib = 1;\n");
    const config = makeConfig(["app/**", "lib/**"]);
    const a = runAllScanners(tmpDir, config);
    const b = runAllScanners(tmpDir, config);
    assert.deepEqual(a.components.map((c) => c.id), b.components.map((c) => c.id));
    assert.deepEqual(a.relationships.map((r) => r.id), b.relationships.map((r) => r.id));
    assert.deepEqual(a.coverage, b.coverage);
  });

  it("Q. src-layout repositories still expand src/<module> as components", () => {
    write(tmpDir, "src/orchestrator/index.ts", "export function run() {}\n");
    write(tmpDir, "src/slack/index.ts", "export function listen() {}\n");
    const config = makeConfig(["src/**"]);
    const results = runAllScanners(tmpDir, config);
    assert.ok(results.components.some((c) => c.id === "orchestrator" && c.path === "src/orchestrator"));
    assert.ok(results.components.some((c) => c.id === "slack" && c.path === "src/slack"));
    assert.ok(!results.components.some((c) => c.id === "src"));
  });

  it("R. empty architecture emits an insufficient-discovery warning", () => {
    const config = makeConfig([]);
    const model = buildSystemModel(tmpDir, join(tmpDir, "docforce.yml"), config, runAllScanners(tmpDir, config));
    const overview = generateArchitectureOverview(model, config);
    const graph = generateDependencyGraph(model);
    assert.match(overview, /Architecture graph unavailable|View unavailable: system-overview/i);
    assert.match(graph, /No evidence-backed software relationships were discovered/i);
    assert.doesNotMatch(overview, /^graph TD\s*$/m);
  });

  it("does not invent a blood-pressure sensor from a keypad UI field", () => {
    write(tmpDir, "app/bp-screen.ts", `
export function BloodPressureScreen(props: { systolic: number; diastolic: number }) {
  return props.systolic;
}
`);
    const config = makeConfig(["app/**"]);
    const results = runAllScanners(tmpDir, config);
    assert.ok(!results.devices.some((d) => /blood/i.test(d.name) || d.kind === "sensor"));
  });

  it("records declared npm dependencies without requiring CATEGORY_MAP", () => {
    write(tmpDir, "package.json", JSON.stringify({
      name: "app",
      dependencies: { "obscure-lib": "1.2.3", next: "16.0.10" },
    }));
    const results = runAllScanners(tmpDir, makeConfig(["package.json"]));
    const obscure = results.technologies.find((t) => t.name === "obscure-lib");
    assert.ok(obscure);
    assert.equal(obscure.category, "dependency");
    assert.equal(obscure.version, "1.2.3");
    const next = results.technologies.find((t) => t.name === "next");
    assert.ok(next);
    assert.equal(next.category, "framework");
  });

  it("merges Firebase client and admin into one datastore", () => {
    write(tmpDir, "package.json", JSON.stringify({
      name: "app",
      dependencies: { firebase: "12.0.0" },
      devDependencies: { "firebase-admin": "13.0.0" },
    }));
    write(tmpDir, "lib/db.ts", 'import { initializeFirestore } from "firebase/firestore";\nconst db = initializeFirestore({} as never, {}, "patdb");\n');
    const results = runAllScanners(tmpDir, makeConfig(["package.json", "lib/**"]));
    const firebaseStores = results.datastores.filter((d) => /firebase|firestore/i.test(d.name));
    assert.equal(firebaseStores.length, 1);
    assert.ok(firebaseStores[0]!.location === "patdb" || firebaseStores[0]!.provenance.evidence.some((e) => /patdb/.test(e.detail ?? "")));
  });

  it("does not treat node_modules as product components", () => {
    write(tmpDir, "app/index.ts", "export const app = 1;\n");
    write(tmpDir, "node_modules/foo/index.ts", "export const n = 1;\n");
    const results = runAllScanners(tmpDir, makeConfig(["app/**", "node_modules/**"]));
    assert.ok(!results.components.some((c) => c.path.includes("node_modules")));
  });
});
