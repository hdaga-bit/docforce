import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runAllScanners } from "../scanner/index.js";
import { buildSystemModel } from "../model/builder.js";
import { DEFAULT_DOCS_OUTPUT } from "../config/types.js";
import { DEFAULT_PR_CONFIG } from "../config/index.js";
import type { DocforceConfig } from "../config/types.js";

export function makeConfig(include: readonly string[], extra?: Partial<DocforceConfig>): DocforceConfig {
  return {
    schemaVersion: "1.0.0",
    product: {
      name: extra?.product?.name ?? "Fixture",
      type: extra?.product?.type ?? "application",
      description: extra?.product?.description ?? "v1.4 publication fixture",
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

export function write(dir: string, rel: string, content: string | Buffer): void {
  const full = join(dir, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

export function analyze(dir: string, config: DocforceConfig) {
  const results = runAllScanners(dir, config);
  const model = buildSystemModel(dir, join(dir, "docforce.yml"), config, results);
  return { results, model, config };
}

export function writePatStyleFixture(dir: string, publicationYml = defaultPublicationYml()): DocforceConfig {
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
}
`);
  write(dir, "app/api/send-report-email/route.ts", `
export async function POST() {
  await fetch("https://api.resend.com/emails", { method: "POST" });
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
  write(dir, "docforce.yml", `product:
  name: PAT
  type: kiosk-application
  description: Self-service kiosk fixture.
scanning:
  rootDir: "."
  include:
    - "app/**"
    - "lib/**"
    - "litert/**"
    - "moonshine/**"
    - "browser/**"
    - "docker-compose.yml"
    - "balena.yml"
    - "package.json"
${publicationYml}
`);
  return makeConfig(
    ["app/**", "lib/**", "litert/**", "moonshine/**", "browser/**", "docker-compose.yml", "balena.yml", "package.json"],
    {
      product: { name: "PAT", type: "kiosk-application", description: "Self-service kiosk fixture." },
      publication: undefined,
    },
  );
}

export function writeMaryForceStyleFixture(dir: string, publicationYml = defaultPublicationYml()): DocforceConfig {
  write(dir, "src/orchestrator/index.ts", "export function run() { return 1; }\n");
  write(dir, "src/slack/app.ts", 'import { run } from "../orchestrator/index.js";\nexport const slack = run;\n');
  write(dir, "package.json", JSON.stringify({
    name: "maryforce",
    dependencies: { "@slack/bolt": "5.0.0", zod: "4.4.3" },
  }));
  write(dir, "maryforce.service", `[Unit]
Description:MaryForce
After=docker.service
Requires=docker.service
[Service]
ExecStart=/usr/bin/npm start
`);
  write(dir, "docforce.yml", `product:
  name: MaryForce
  type: ai-engineering-platform
  description: Slack-to-Claude orchestrator.
scanning:
  rootDir: "."
  include:
    - "src/**"
    - "package.json"
    - "maryforce.service"
${publicationYml}
`);
  return makeConfig(["src/**", "package.json", "maryforce.service"], {
    product: { name: "MaryForce", type: "ai-engineering-platform", description: "Slack-to-Claude orchestrator." },
  });
}

export function defaultPublicationYml(): string {
  return `publication:
  organization:
    name: Example Organization
  document:
    title: Technical Architecture & Design Document
    classification: Internal
    status: Current
  footer:
    text: Example Organization
`;
}
