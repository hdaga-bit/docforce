import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { DocforceConfig } from "../config/types.js";
import { DEFAULT_PR_CONFIG } from "../config/index.js";
import { DEFAULT_DOCS_OUTPUT } from "../config/types.js";
import type { Provenance, SystemModel, TechnologyInfo } from "../model/types.js";
import { EMPTY_COVERAGE } from "../model/builder.js";
import { classifyTechnology } from "./classifyTechnology.js";
import { classifyComponent } from "./classifyComponent.js";
import { buildDocumentationViewModel } from "./buildViewModel.js";
import { apiRouteGroupName, groupApiRoutes } from "./groupApiRoutes.js";
import { generateTechnicalOverview } from "../generator/technicalOverview.js";
import { generateTechnologyInventory } from "../generator/technologyInventory.js";
import {
  generateDataArchitecture,
  generateDeploymentArchitecture,
  generateDeviceArchitecture,
  generateSoftwareArchitecture,
  generateSystemOverview,
} from "../generator/architectureViews.js";
import { generateApiInventory } from "../generator/apiInventory.js";
import { ARTIFACT_REGISTRY } from "../update/artifactRegistry.js";
import { DOCUMENT_REGISTRY, getRegisteredArtifacts } from "../impact/documentRegistry.js";
import { assessDeterministicDocs } from "../pr/deterministicDocs.js";
import type { ChangeImpactReport } from "../impact/types.js";

function prov(sourceFile = "package.json", evidenceType = "dependency"): Provenance {
  return {
    kind: "observation",
    confidence: "high",
    evidence: [{ sourceFile, evidenceType }],
  };
}

function baseConfig(overrides: Partial<DocforceConfig> = {}): DocforceConfig {
  return {
    schemaVersion: "1.0.0",
    product: { name: "Fixture", type: "application", description: "View fixture" },
    scanning: { rootDir: ".", include: [], exclude: [] },
    analysis: { exclude: [] },
    architecture: { components: {} },
    output: { systemModel: ".docforce/system-model.json", docs: DEFAULT_DOCS_OUTPUT },
    documentation: { allowedRoots: ["docs/"], aiAssisted: [] },
    ai: {},
    pr: DEFAULT_PR_CONFIG,
    ...overrides,
  };
}

function baseModel(overrides: Partial<SystemModel> = {}): SystemModel {
  return {
    metadata: {
      schemaVersion: "1.0.0",
      docforceVersion: "1.1.0",
      repositoryName: "fixture",
      repositoryRoot: "/tmp/fixture",
      git: { commitSha: "abc", branch: "main", dirty: false },
      generatedAt: "2026-09-01T00:00:00.000Z",
      configHash: "deadbeef",
    },
    product: { name: "Fixture", type: "application", description: "View fixture" },
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
    ...overrides,
  };
}

function tech(name: string, extra: Partial<TechnologyInfo> = {}): TechnologyInfo {
  return {
    name,
    category: extra.category ?? "dependency",
    version: extra.version,
    purpose: extra.purpose,
    provenance: extra.provenance ?? prov(),
  };
}

describe("A. dependency importance classification", () => {
  const model = baseModel({
    datastores: [{ name: "Firebase (patdb)", type: "cloud-database", engine: "Firebase", provenance: prov("lib/db.ts") }],
    integrations: [{ name: "AskMary", type: "external-api", direction: "outbound", protocol: "HTTPS", provenance: prov("lib/api.ts") }],
  });
  const config = baseConfig();

  it("elevates next as core-platform and react as framework", () => {
    assert.equal(classifyTechnology(tech("next", { category: "framework" }), model, config).presentation, "core-platform");
    assert.equal(classifyTechnology(tech("react", { category: "frontend" }), model, config).presentation, "framework");
  });

  it("classifies firebase as datastore when datastore evidence exists", () => {
    assert.equal(classifyTechnology(tech("firebase", { category: "cloud" }), model, config).presentation, "datastore");
  });

  it("classifies radix/ui primitives as supporting libraries", () => {
    assert.equal(
      classifyTechnology(tech("@radix-ui/react-dialog"), model, config).presentation,
      "supporting-library",
    );
    assert.equal(classifyTechnology(tech("clsx"), model, config).presentation, "supporting-library");
  });

  it("classifies docker/balena as infrastructure", () => {
    assert.equal(
      classifyTechnology(tech("Docker", { category: "containerization" }), model, config).presentation,
      "infrastructure",
    );
    assert.equal(
      classifyTechnology(tech("Balena", { category: "device-fleet" }), model, config).presentation,
      "infrastructure",
    );
  });
});

describe("B. development dependency demotion", () => {
  it("devDependencies become development-tool", () => {
    const item = classifyTechnology(
      tech("eslint", { provenance: prov("package.json", "devDependency") }),
      baseModel(),
      baseConfig(),
    );
    assert.equal(item.presentation, "development-tool");
  });

  it("tooling category is development-tool even as a production listing", () => {
    const item = classifyTechnology(tech("tsx", { category: "tooling" }), baseModel(), baseConfig());
    assert.equal(item.presentation, "development-tool");
  });
});

describe("C. technology override affects presentation only", () => {
  it("override changes view class without mutating the System Model entity", () => {
    const original = tech("some-package", { category: "dependency", purpose: "Declared runtime dependency" });
    const model = baseModel({ technologies: [original] });
    const snapshot = JSON.stringify(model);
    const config = baseConfig({
      documentation: {
        allowedRoots: ["docs/"],
        aiAssisted: [],
        technologyOverrides: { "some-package": { presentation: "supporting-library" } },
      },
    });
    const view = classifyTechnology(original, model, config);
    assert.equal(view.presentation, "supporting-library");
    assert.equal(view.overridden, true);
    assert.equal(model.technologies[0]!.category, "dependency");
    assert.equal(model.technologies[0]!.purpose, "Declared runtime dependency");
    assert.equal(JSON.stringify(model), snapshot);
  });
});

describe("D. system overview grouping", () => {
  it("groups entities by type categories and stays small", () => {
    const model = baseModel({
      components: [
        { id: "app", name: "app", path: "app", type: "module", entryPoints: ["app/page.tsx"], provenance: prov("app/page.tsx") },
        { id: "lib", name: "lib", path: "lib", type: "module", provenance: prov("lib/index.ts") },
      ],
      relationships: [
        rel("app", "lib", "imports"),
        rel("app", "lib", "imports", "rel-2"),
        rel("lib", "app", "imports"),
        rel("app", "store:sqlite", "persists-to"),
      ],
      datastores: [{ name: "SQLite", type: "embedded-database", provenance: prov() }],
      integrations: [{ name: "Mail Host", type: "external-api", direction: "outbound", provenance: prov() }],
      infrastructure: [
        { type: "docker-service", name: "sidecar", provenance: prov("docker-compose.yml") },
        { type: "docker-volume", name: "data", provenance: prov("docker-compose.yml") },
      ],
      devices: [{ id: "iface:serial", kind: "communication-interface", name: "serial", provenance: prov() }],
    });
    const diagram = generateSystemOverview(model, baseConfig());
    assert.ok(diagram.includes("graph TD"));
    assert.ok(diagram.includes("Application / Software"));
    assert.ok(diagram.includes("Local Services"));
    assert.ok(diagram.includes("Data / Storage"));
    assert.ok(diagram.includes("sidecar"));
    assert.ok(!diagram.includes("data") || !/subgraph Named Volumes/.test(diagram));
    assert.ok(!diagram.includes("@radix-ui"));
  });
});

describe("E. software architecture filtering", () => {
  it("excludes utility components and named volumes", () => {
    const model = baseModel({
      components: [
        { id: "app", name: "app", path: "app", type: "module", entryPoints: ["app/page.tsx"], provenance: prov("app") },
        { id: "config", name: "config", path: "src/config", type: "module", provenance: prov("src/config") },
      ],
      relationships: [rel("app", "config", "imports")],
      infrastructure: [
        { type: "docker-service", name: "app", provenance: prov("docker-compose.yml") },
        { type: "docker-volume", name: "relay-journal", provenance: prov("docker-compose.yml") },
      ],
    });
    const config = baseConfig({
      architecture: { components: { config: { includeInOverview: false } } },
    });
    const diagram = generateSoftwareArchitecture(model, config);
    assert.ok(diagram.includes("app"));
    assert.ok(!diagram.includes("Configuration") && !diagram.includes('config"]'));
    assert.ok(!diagram.includes("relay-journal"));
  });
});

describe("F. deployment view services vs volumes", () => {
  it("renders compose services and named volumes in distinct subgraphs", () => {
    const model = baseModel({
      infrastructure: [
        { type: "docker-service", name: "app", detail: "depends_on browser", provenance: prov("docker-compose.yml") },
        { type: "docker-service", name: "browser", provenance: prov("docker-compose.yml") },
        { type: "docker-volume", name: "chromium-profile", provenance: prov("docker-compose.yml") },
        { type: "device-fleet", name: "pat-healthcare-kiosk", provenance: prov("balena.yml") },
      ],
    });
    const diagram = generateDeploymentArchitecture(model, baseConfig());
    assert.ok(diagram.includes("subgraph Services"));
    assert.ok(diagram.includes("subgraph Named Volumes"));
    assert.ok(diagram.includes("subgraph Fleet / Deployment Target"));
    assert.ok(diagram.includes("depends_on"));
    assert.ok(diagram.includes("chromium-profile"));
    assert.ok(diagram.includes("pat-healthcare-kiosk"));
  });
});

describe("G/H. device view evidence and unsupported hardware", () => {
  it("G. only evidence-backed device entities and relationships appear", () => {
    const model = baseModel({
      components: [{ id: "app", name: "app", path: "app", type: "module", provenance: prov("app") }],
      devices: [
        { id: "iface:serial", kind: "communication-interface", name: "serial", provenance: prov("app/serial.ts") },
        { id: "peripheral:camera", kind: "peripheral", name: "camera", provenance: prov("app/media.ts") },
      ],
      relationships: [
        {
          id: "rel:app:communicates-over:iface:serial",
          from: "app",
          to: "iface:serial",
          type: "communicates-over",
          classification: "observation",
          confidence: "high",
          evidence: [{ sourceFile: "app/serial.ts", evidenceType: "web-serial-api" }],
        },
      ],
    });
    const diagram = generateDeviceArchitecture(model, baseConfig());
    assert.ok(diagram.includes("serial"));
    assert.ok(diagram.includes("camera"));
    assert.ok(diagram.includes("over"));
    assert.ok(!diagram.includes("bluetooth"));
    assert.ok(!diagram.includes("GPIO"));
  });

  it("H. unsupported blood-pressure hardware stays absent", () => {
    const model = baseModel({
      components: [
        { id: "app", name: "app", path: "app", type: "module", provenance: prov("app") },
        { id: "bp-screen", name: "BloodPressureScreen", path: "app/bp-screen", type: "module", provenance: prov("app/bp-screen.ts") },
      ],
      devices: [{ id: "peripheral:camera", kind: "peripheral", name: "camera", provenance: prov("app/media.ts") }],
    });
    const diagram = generateDeviceArchitecture(model, baseConfig());
    assert.ok(diagram.includes("camera"));
    assert.doesNotMatch(diagram, /blood-pressure|bluetooth|GPIO|I2C|SPI|Arduino/i);
    assert.ok(!diagram.includes("BloodPressureScreen"));
  });
});

describe("I. data view", () => {
  it("shows datastores even without persistence edges", () => {
    const model = baseModel({
      datastores: [
        { name: "Firebase", type: "cloud-database", provenance: prov() },
        { name: "localStorage", type: "browser-storage", provenance: prov() },
      ],
    });
    const diagram = generateDataArchitecture(model, baseConfig());
    assert.ok(diagram.includes("Firebase"));
    assert.ok(diagram.includes("localStorage"));
    assert.ok(!diagram.includes("persists"));
  });

  it("draws persist edges only when evidenced", () => {
    const model = baseModel({
      components: [{ id: "lib", name: "lib", path: "lib", type: "module", provenance: prov("lib") }],
      datastores: [{ name: "SQLite", type: "embedded-database", provenance: prov() }],
      relationships: [rel("lib", "store:sqlite", "persists-to")],
    });
    const diagram = generateDataArchitecture(model, baseConfig());
    assert.ok(diagram.includes("persists"));
    assert.ok(diagram.includes("lib"));
  });
});

describe("J/K. API grouping and inventory", () => {
  it("J. groups routes by repository path segment after /api/", () => {
    assert.equal(apiRouteGroupName("/api/voice/stt"), "voice");
    assert.equal(apiRouteGroupName("/api/health"), "health");
    const groups = groupApiRoutes([
      route("/api/voice/stt", "app/api/voice/stt/route.ts", ["POST"]),
      route("/api/voice/tts", "app/api/voice/tts/route.ts", ["POST"]),
      route("/api/health", "app/api/health/route.ts", ["GET"]),
    ], [{ id: "app", name: "app", path: "app", type: "module", provenance: prov("app") }]);
    assert.equal(groups.length, 2);
    assert.equal(groups[0]!.group, "health");
    assert.equal(groups[1]!.group, "voice");
    assert.equal(groups[1]!.routes.length, 2);
  });

  it("K. inventory shows route, methods, source, and evidenced component", () => {
    const model = baseModel({
      components: [{ id: "app", name: "app", path: "app", type: "module", provenance: prov("app") }],
      apiRoutes: [
        route("/api/voice/stt", "app/api/voice/stt/route.ts", ["POST"]),
        route("/api/health", "app/api/health/route.ts", ["GET"]),
      ],
    });
    const md = generateApiInventory(model, baseConfig());
    assert.ok(md.includes("`/api/voice/stt`"));
    assert.ok(md.includes("POST"));
    assert.ok(md.includes("`app/api/voice/stt/route.ts`"));
    assert.ok(md.includes("app"));
    assert.ok(md.includes("## voice"));
    assert.ok(!md.includes("authentication"));
  });
});

describe("L. technical-overview conditional sections", () => {
  it("omits API, device, and data sections when unsupported", () => {
    const model = baseModel({
      runtime: [{ name: "Node.js", provenance: prov() }],
      components: [{ id: "app", name: "app", path: "src/app", type: "module", provenance: prov("src/app") }],
    });
    const md = generateTechnicalOverview(model, baseConfig());
    assert.ok(md.includes("## Product Technical Summary"));
    assert.ok(md.includes("## Languages & Runtime"));
    assert.ok(!md.includes("## Local API Surface"));
    assert.ok(!md.includes("## Device / Peripheral Interfaces"));
    assert.ok(!md.includes("## Data & Storage"));
    assert.ok(!md.includes("## External Integrations"));
  });

  it("summarizes API groups instead of dumping routes", () => {
    const model = baseModel({
      apiRoutes: Array.from({ length: 5 }, (_, i) => route(`/api/voice/r${i}`, `app/api/voice/r${i}/route.ts`, ["GET"])),
    });
    const md = generateTechnicalOverview(model, baseConfig());
    assert.ok(md.includes("5 local API routes were detected across 1 top-level route group"));
    assert.ok(!md.includes("`/api/voice/r0`"));
    assert.ok(md.includes("api-inventory.md"));
  });
});

describe("M. presentation change does not modify System Model", () => {
  it("buildDocumentationViewModel leaves the model JSON unchanged", () => {
    const model = baseModel({
      technologies: [tech("next", { category: "framework" }), tech("@radix-ui/react-dialog")],
      components: [{ id: "app", name: "app", path: "app", type: "module", provenance: prov("app") }],
    });
    const before = JSON.stringify(model);
    buildDocumentationViewModel(model, baseConfig());
    generateTechnologyInventory(model, baseConfig());
    generateSystemOverview(model, baseConfig());
    assert.equal(JSON.stringify(model), before);
  });
});

describe("N. new artifacts participate in the update registry", () => {
  it("registers specialized views and api inventory", () => {
    const ids = getRegisteredArtifacts();
    for (const id of [
      "system-overview.mmd",
      "software-architecture.mmd",
      "deployment-architecture.mmd",
      "data-architecture.mmd",
      "device-architecture.mmd",
      "api-inventory.md",
      "configuration-inventory.md",
      "technical-architecture.md",
      "technical-overview.md",
      "architecture.mmd",
    ]) {
      assert.ok(ids.includes(id), `missing ${id}`);
    }
    assert.equal(DOCUMENT_REGISTRY.length, ARTIFACT_REGISTRY.length);
    const api = ARTIFACT_REGISTRY.find((a) => a.id === "api-inventory.md");
    assert.ok(api?.dependsOn.includes("api-routes"));
    const device = ARTIFACT_REGISTRY.find((a) => a.id === "device-architecture.mmd");
    assert.ok(device?.dependsOn.includes("devices"));
  });
});

describe("O. PR currency detects stale new artifacts", () => {
  it("marks api-inventory.md missing when affected and absent", () => {
    const model = baseModel({
      apiRoutes: [route("/api/health", "app/api/health/route.ts", ["GET"])],
    });
    const report = impactReport(["api-inventory.md"]);
    const assessment = assessDeterministicDocs({
      config: baseConfig(),
      headModel: model,
      impactReport: report,
      readArtifact: () => undefined,
    });
    const api = assessment.artifacts.find((a) => a.artifact === "api-inventory.md");
    assert.equal(api?.status, "missing");
  });

  it("marks device-architecture.mmd stale when content differs", () => {
    const model = baseModel({
      devices: [{ id: "iface:serial", kind: "communication-interface", name: "serial", provenance: prov() }],
    });
    const report = impactReport(["device-architecture.mmd"]);
    const assessment = assessDeterministicDocs({
      config: baseConfig(),
      headModel: model,
      impactReport: report,
      readArtifact: () => "%% stale\n",
    });
    const device = assessment.artifacts.find((a) => a.artifact === "device-architecture.mmd");
    assert.equal(device?.status, "stale");
  });
});

describe("P. MaryForce fixture compatibility", () => {
  it("src-layout components remain in the System Model while presentation is applied", () => {
    const model = baseModel({
      components: [
        { id: "orchestrator", name: "orchestrator", path: "src/orchestrator", type: "module", provenance: prov("src/orchestrator") },
        { id: "slack", name: "slack", path: "src/slack", type: "module", provenance: prov("src/slack") },
      ],
      relationships: [rel("slack", "orchestrator", "imports")],
      infrastructure: [{ type: "systemd-service", name: "maryforce", provenance: prov("maryforce.service") }],
    });
    const snapshot = JSON.stringify(model.components);
    const view = buildDocumentationViewModel(model, baseConfig());
    assert.equal(model.components.length, 2);
    assert.equal(JSON.stringify(model.components), snapshot);
    assert.equal(view.components.length, 2);
    const overview = generateTechnicalOverview(model, baseConfig());
    assert.ok(overview.includes("orchestrator"));
    assert.ok(overview.includes("Deployment & Infrastructure"));
    assert.ok(overview.includes("maryforce"));
  });
});

describe("Q. PAT-style fixture produces useful multi-view docs", () => {
  it("separates noisy UI libs from platform and shows compose/API/device views", () => {
    const model = patStyleModel();
    const inventory = generateTechnologyInventory(model, baseConfig());
    assert.ok(inventory.includes("## Core Platform"));
    assert.ok(inventory.includes("next"));
    assert.ok(inventory.includes("## Supporting Libraries"));
    assert.ok(inventory.includes("@radix-ui/react-dialog"));
    const appendixIdx = inventory.indexOf("## Full Dependency Appendix");
    const supportingIdx = inventory.indexOf("## Supporting Libraries");
    const coreIdx = inventory.indexOf("## Core Platform");
    assert.ok(coreIdx < supportingIdx);
    assert.ok(supportingIdx < appendixIdx);

    const overview = generateTechnicalOverview(model, baseConfig());
    assert.ok(overview.includes("23 local API routes were detected across 7 top-level route groups"));
    assert.ok(!overview.includes("`/api/voice/stt`"));

    const system = generateSystemOverview(model, baseConfig());
    assert.ok(system.includes("graph TD"));
    assert.ok(system.includes("Local Services"));

    const deploy = generateDeploymentArchitecture(model, baseConfig());
    assert.ok(deploy.includes("subgraph Services"));
    assert.ok(deploy.includes("subgraph Named Volumes"));
    assert.ok(deploy.includes("litert"));
    assert.ok(deploy.includes("relay-journal"));

    const data = generateDataArchitecture(model, baseConfig());
    assert.ok(data.includes("Firebase"));
    assert.ok(data.includes("localStorage"));

    const device = generateDeviceArchitecture(model, baseConfig());
    assert.ok(device.includes("serial"));
    assert.doesNotMatch(device, /blood-pressure|Bluetooth|GPIO|Arduino/i);

    const api = generateApiInventory(model, baseConfig());
    assert.equal((api.match(/\| `\/api\//g) ?? []).length, 23);
  });
});

describe("R. insufficient-view behavior", () => {
  it("emits a marked unavailable artifact rather than an empty graph", () => {
    const model = baseModel();
    const device = generateDeviceArchitecture(model, baseConfig());
    const deploy = generateDeploymentArchitecture(model, baseConfig());
    const data = generateDataArchitecture(model, baseConfig());
    for (const artifact of [device, deploy, data]) {
      assert.ok(artifact.includes("View unavailable:"));
      assert.ok(artifact.includes("Insufficient evidence"));
      assert.ok(!artifact.includes("graph TD"));
    }
  });
});

describe("component presentation signals", () => {
  it("keeps neutral when confidence is inadequate", () => {
    const item = classifyComponent(
      { id: "util", name: "util", path: "lib/util", type: "module", provenance: prov("lib/util") },
      baseModel({
        components: [{ id: "util", name: "util", path: "lib/util", type: "module", provenance: prov("lib/util") }],
      }),
      baseConfig(),
    );
    assert.equal(item.presentation, "neutral");
  });
});

function rel(
  from: string,
  to: string,
  type: "imports" | "persists-to" | "depends-on" | "runs-on" | "attached-to" | "communicates-over",
  id?: string,
): SystemModel["relationships"][number] {
  return {
    id: id ?? `rel:${from}:${type}:${to}`,
    from,
    to,
    type,
    classification: "observation",
    confidence: "high",
    evidence: [{ sourceFile: "src/a.ts", evidenceType: "module-import" }],
  };
}

function route(path: string, sourceFile: string, methods: string[]): SystemModel["apiRoutes"][number] {
  return {
    path,
    sourceFile,
    methods,
    provenance: prov(sourceFile, "api-route"),
  };
}

function impactReport(affected: string[]): ChangeImpactReport {
  return {
    baseRef: "main",
    headRef: "HEAD",
    generatedAt: "2026-09-01T00:00:00.000Z",
    docforceVersion: "1.1.0",
    fileChanges: [],
    modelDelta: {
      entityChanges: [],
      relationshipChanges: [],
      changedDomains: new Set(),
      isEmpty: true,
    },
    overallImpactLevel: "low",
    manualReviewRecommended: false,
    documentImpacts: ARTIFACT_REGISTRY.map((artifact) => ({
      artifact: artifact.id,
      affected: affected.includes(artifact.id),
      impactLevel: affected.includes(artifact.id) ? "high" : "none",
      reason: affected.includes(artifact.id) ? "test" : "No relevant model domains changed",
      triggeringDomains: affected.includes(artifact.id) ? ["api-routes"] : [],
    })),
    unknowns: [],
  };
}

function patStyleModel(): SystemModel {
  const plan: readonly [string, number][] = [
    ["voice", 5],
    ["health", 3],
    ["print", 3],
    ["kiosk", 3],
    ["session", 3],
    ["admin", 3],
    ["files", 3],
  ];
  const routes: SystemModel["apiRoutes"][number][] = [];
  for (const [group, count] of plan) {
    for (let i = 0; i < count; i++) {
      const name = i === 0 ? group : `${group}-${i}`;
      const path = group === "health" && i === 0 ? "/api/health" : `/api/${group}/${name}`;
      routes.push(route(path, `app/api/${group}/${name}/route.ts`, i % 2 === 0 ? ["GET"] : ["POST"]));
    }
  }

  return baseModel({
    runtime: [{ name: "Node.js", provenance: prov() }],
    languages: [
      { name: "TypeScript", provenance: prov() },
      { name: "Python", provenance: prov("browser/main.py") },
    ],
    technologies: [
      tech("next", { category: "framework" }),
      tech("react", { category: "frontend" }),
      tech("firebase", { category: "cloud" }),
      tech("@radix-ui/react-dialog"),
      tech("clsx"),
      tech("eslint", { provenance: prov("package.json", "devDependency") }),
    ],
    components: [
      { id: "app", name: "app", path: "app", type: "module", entryPoints: ["app/page.tsx"], provenance: prov("app") },
      { id: "lib", name: "lib", path: "lib", type: "module", provenance: prov("lib") },
      { id: "browser", name: "browser", path: "browser", type: "module", provenance: prov("browser") },
      { id: "litert", name: "litert", path: "litert", type: "module", provenance: prov("litert") },
    ],
    relationships: [
      rel("app", "lib", "imports"),
      rel("app", "lib", "imports", "rel-app-lib-2"),
      rel("lib", "app", "imports"),
      rel("browser", "lib", "imports"),
    ],
    datastores: [
      { name: "Firebase", type: "cloud-database", engine: "Firebase", location: "patdb", provenance: prov("lib/db.ts") },
      { name: "localStorage", type: "browser-storage", provenance: prov("lib/storage.ts") },
    ],
    infrastructure: [
      { type: "docker-service", name: "app", detail: "depends_on browser,litert", provenance: prov("docker-compose.yml") },
      { type: "docker-service", name: "browser", provenance: prov("docker-compose.yml") },
      { type: "docker-service", name: "litert", provenance: prov("docker-compose.yml") },
      { type: "docker-service", name: "moonshine", provenance: prov("docker-compose.yml") },
      { type: "docker-volume", name: "relay-journal", provenance: prov("docker-compose.yml") },
      { type: "device-fleet", name: "pat-healthcare-kiosk", provenance: prov("balena.yml") },
    ],
    devices: [
      { id: "device:balena-fleet", kind: "device", name: "pat-healthcare-kiosk", provenance: prov("balena.yml") },
      { id: "iface:serial", kind: "communication-interface", name: "serial", provenance: prov("lib/serial.ts") },
      { id: "peripheral:usb-lp", kind: "peripheral", name: "USB printer", provenance: prov("lib/print.ts") },
    ],
    apiRoutes: routes,
  });
}
