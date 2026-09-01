import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ScanResults } from "../model/builder.js";
import { EMPTY_COVERAGE } from "../model/builder.js";
import type { DocforceConfig } from "../config/types.js";
import type {
  DeviceInfo,
  DiscoveryCoverage,
  IntegrationInfo,
  Evidence,
  Relationship,
  UnknownArea,
} from "../model/types.js";
import { scanPackageJson } from "./packageJson.js";
import { scanTsconfig } from "./tsconfig.js";
import { scanDocker } from "./docker.js";
import { scanGithubActions } from "./github.js";
import { scanSystemd } from "./systemd.js";
import { scanEnvironment } from "./environment.js";
import { scanDatabase } from "./database.js";
import { scanSourceImports, collectImportsScoped } from "./sourceImports.js";
import { scanPython } from "./python.js";
import { scanNextAppRouter } from "./nextjs.js";
import { scanBalena, scanDevices } from "./device.js";
import {
  buildInternalImportGraph,
  buildExternalIntegrationRelationships,
  buildDatastoreRelationships,
  detectLocalConstantIntegrations,
  detectLiteralFetchIntegrations,
  resolveComponentForFile,
  sanitizeId,
} from "./relationships.js";
import { normalizeExternalEntities } from "./normalize.js";
import { resolveScanScope } from "./scanScope.js";
import {
  buildComposeDependsOnRelationships,
  buildLocalServiceHttpRelationships,
  buildSoftwareServiceDeployRelationships,
  buildVolumeMountRelationships,
  loadComposeServices,
} from "./localHttp.js";
import { buildDatastoreOperationRelationships } from "./datastoreOperations.js";
import type { TechnologyInfo } from "../model/types.js";

export function runAllScanners(repoRoot: string, config?: DocforceConfig): ScanResults {
  const analysisExclusions = config?.analysis.exclude ?? [];

  const pkg = scanPackageJson(repoRoot);
  const ts = scanTsconfig(repoRoot);
  const docker = scanDocker(repoRoot, config);
  const github = scanGithubActions(repoRoot);
  const systemd = scanSystemd(repoRoot);
  const env = scanEnvironment(repoRoot);
  const db = scanDatabase(repoRoot, analysisExclusions, config);
  const source = scanSourceImports(repoRoot, analysisExclusions, config);
  const python = scanPython(repoRoot, config);
  const apiRoutes = scanNextAppRouter(repoRoot, config);
  const balena = scanBalena(repoRoot, config);

  const components = source.components.map((c) => ({
    ...c,
    id: c.id || c.name,
  }));

  const localConstIntegrations = [
    ...detectLocalConstantIntegrations(repoRoot, analysisExclusions, config),
    ...detectLiteralFetchIntegrations(repoRoot, analysisExclusions, config),
  ];
  const existingIntegrationNames = new Set(source.integrations.map((i) => i.name));
  const additionalIntegrations: IntegrationInfo[] = [];

  for (const lci of localConstIntegrations) {
    if (existingIntegrationNames.has(lci.name)) continue;
    existingIntegrationNames.add(lci.name);

    const evidence: Evidence[] = [{
      sourceFile: lci.sourceFile,
      evidenceType: lci.constantName === "(literal)" ? "api-request" : "local-constant-resolution",
      line: lci.usageLine,
      detail: lci.constantName === "(literal)"
        ? `fetch("${lci.constantValue}")`
        : `${lci.constantName} = "${lci.constantValue}" → API call detected`,
    }];

    additionalIntegrations.push({
      name: lci.name,
      type: lci.type,
      direction: lci.direction,
      protocol: lci.protocol,
      provenance: {
        kind: lci.constantName === "(literal)" ? "observation" : "inference",
        confidence: lci.constantName === "(literal)" ? "high" : "medium",
        evidence,
        reasoning: lci.constantName === "(literal)"
          ? undefined
          : `Resolved same-file constant ${lci.constantName} to literal value "${lci.constantValue}" which matches API pattern`,
      },
    });
  }

  const normalized = normalizeExternalEntities(
    [...source.integrations, ...additionalIntegrations],
    db.datastores,
  );
  const finalIntegrations = normalized.integrations;
  const finalDatastores = normalized.datastores;

  const deviceScan = scanDevices(repoRoot, components, config);
  const devices = mergeDevices([...balena.devices, ...deviceScan.devices]);

  const dockerServices = docker.infrastructure.filter((i) => i.type === "docker-service");
  if (devices.some((d) => d.kind === "device")) {
    for (const svc of dockerServices) {
      const id = `dsvc:${sanitizeId(svc.name)}`;
      if (!devices.some((d) => d.id === id)) {
        devices.push({
          id,
          kind: "device-service",
          name: svc.name,
          detail: svc.detail,
          provenance: svc.provenance,
        });
      }
    }
  }

  const internalRels = buildInternalImportGraph(repoRoot, components, analysisExclusions, config);
  const externalRels = buildExternalIntegrationRelationships(components, finalIntegrations);
  const datastoreRels = buildDatastoreRelationships(components, finalDatastores);
  const datastoreOpRels = buildDatastoreOperationRelationships(
    repoRoot,
    components,
    finalDatastores,
    analysisExclusions,
    config,
  );
  const composeServices = loadComposeServices(repoRoot, config);
  const localHttpRels = buildLocalServiceHttpRelationships(
    repoRoot,
    components,
    analysisExclusions,
    config,
    composeServices,
  );
  const composeDependsRels = buildComposeDependsOnRelationships(composeServices);
  const softwareDeployRels = buildSoftwareServiceDeployRelationships(components, composeServices);
  const namedVolumes = docker.infrastructure.filter((item) => item.type === "docker-volume").map((item) => item.name);
  const volumeMountRels = buildVolumeMountRelationships(composeServices, namedVolumes);

  const localConstRels: Relationship[] = [];
  for (const lci of localConstIntegrations) {
    const comp = resolveComponentForFile(lci.sourceFile, components);
    if (!comp) continue;
    const sanitizedName = sanitizeId(lci.name);
    if (externalRels.some((r) => r.from === comp.id && r.to === `ext:${sanitizedName}`)) continue;
    localConstRels.push({
      id: `rel:${comp.id}:calls-api:ext:${sanitizedName}`,
      from: comp.id,
      to: `ext:${sanitizedName}`,
      type: "calls-api",
      classification: "observation",
      confidence: "high",
      evidence: [{
        sourceFile: lci.sourceFile,
        evidenceType: lci.constantName === "(literal)" ? "api-request" : "local-constant-resolution",
        line: lci.usageLine,
        detail: `${lci.constantName} = "${lci.constantValue}" → API call`,
      }],
      description: `${comp.id} calls ${lci.name}`,
    });
  }

  const runsOnRels: Relationship[] = [];
  const fleet = devices.find((d) => d.kind === "device");
  if (fleet) {
    for (const svc of dockerServices) {
      const comp = components.find((c) => c.id === svc.name);
      if (!comp) continue;
      runsOnRels.push({
        id: `rel:${comp.id}:runs-on:${fleet.id}`,
        from: comp.id,
        to: fleet.id,
        type: "runs-on",
        classification: "observation",
        confidence: "high",
        evidence: [...svc.provenance.evidence, ...fleet.provenance.evidence],
        description: `${comp.id} runs-on ${fleet.name}`,
      });
    }
  }

  const allRelationships = deduplicateRelationships([
    ...internalRels,
    ...python.relationships,
    ...externalRels,
    ...datastoreRels,
    ...datastoreOpRels,
    ...localHttpRels,
    ...composeDependsRels,
    ...softwareDeployRels,
    ...volumeMountRels,
    ...localConstRels,
    ...deviceScan.relationships,
    ...runsOnRels,
  ]);

  const unknowns = detectUnknowns(repoRoot, pkg, ts, docker, github);
  const coverage = buildCoverage({
    components,
    apiRoutes,
    docker,
    devices,
    python,
  });

  const languages = uniqByName([
    ...pkg.languages,
    ...ts.languages,
    ...python.languages,
  ]);

  const importScope = resolveScanScope(config);
  const sourceImports = collectImportsScoped(repoRoot, {
    ...importScope,
    exclude: [...importScope.exclude, ...analysisExclusions],
  });

  return {
    runtime: [...pkg.runtime],
    languages,
    technologies: attachRuntimeImportEvidence(uniqByName([
      ...pkg.technologies,
      ...ts.technologies,
      ...docker.technologies,
      ...github.technologies,
      ...env.technologies,
      ...python.technologies,
      ...balena.technologies,
    ]), sourceImports),
    components,
    datastores: [...finalDatastores],
    integrations: finalIntegrations,
    infrastructure: [...docker.infrastructure, ...systemd.infrastructure, ...balena.infrastructure],
    workflows: [...github.workflows],
    relationships: allRelationships,
    unknowns,
    apiRoutes,
    devices,
    coverage,
  };
}

function attachRuntimeImportEvidence(
  technologies: TechnologyInfo[],
  imports: { sourceFile: string; importedModule: string; isExternal: boolean; line: number }[],
): TechnologyInfo[] {
  return technologies.map((tech) => {
    const hits = imports.filter((imp) =>
      imp.isExternal
      && moduleMatchesPackage(imp.importedModule, tech.name)
      && !isTestPath(imp.sourceFile),
    );
    if (hits.length === 0) return tech;
    return {
      ...tech,
      provenance: {
        ...tech.provenance,
        evidence: [
          ...tech.provenance.evidence,
          ...hits.slice(0, 5).map((hit) => ({
            sourceFile: hit.sourceFile,
            evidenceType: "module-import",
            line: hit.line,
            detail: `import from "${hit.importedModule}"`,
          })),
        ],
      },
    };
  });
}

function moduleMatchesPackage(importedModule: string, packageName: string): boolean {
  return importedModule === packageName || importedModule.startsWith(`${packageName}/`);
}

function isTestPath(relPath: string): boolean {
  return /(?:^|\/)(?:__tests__|test|tests|spec)\/|\.(?:test|spec)\.[jt]sx?$/.test(relPath);
}

function mergeDevices(list: DeviceInfo[]): DeviceInfo[] {
  const map = new Map<string, DeviceInfo>();
  for (const d of list) {
    const existing = map.get(d.id);
    if (!existing) {
      map.set(d.id, d);
    } else {
      map.set(d.id, {
        ...existing,
        provenance: {
          ...existing.provenance,
          evidence: [...existing.provenance.evidence, ...d.provenance.evidence],
        },
      });
    }
  }
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function uniqByName<T extends { name: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = `${item.name}:${(item as { category?: string }).category ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function buildCoverage(input: {
  components: { path: string }[];
  apiRoutes: { path: string }[];
  docker: ReturnType<typeof scanDocker>;
  devices: DeviceInfo[];
  python: ReturnType<typeof scanPython>;
}): DiscoveryCoverage {
  const pythonPaths = new Set(input.python.pythonRoots);
  const tsRoots = input.components.filter((c) => !pythonPaths.has(c.path)).length;
  return {
    typescriptJavascriptRoots: tsRoots,
    pythonRoots: input.python.pythonRoots.length,
    apiRoutes: input.apiRoutes.length,
    composeServices: input.docker.infrastructure.filter((i) => i.type === "docker-service").length,
    composeVolumes: input.docker.infrastructure.filter((i) => i.type === "docker-volume").length,
    deviceEvidence: input.devices.length,
    unsupportedEvidence: [],
  };
}

function deduplicateRelationships(rels: Relationship[]): Relationship[] {
  const seen = new Map<string, Relationship>();
  for (const rel of rels) {
    const key = `${rel.from}:${rel.type}:${rel.to}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, rel);
    } else {
      seen.set(key, {
        ...existing,
        evidence: [...existing.evidence, ...rel.evidence],
        description: existing.description || rel.description,
      });
    }
  }
  return [...seen.values()];
}

function detectUnknowns(
  repoRoot: string,
  pkg: ReturnType<typeof scanPackageJson>,
  ts: ReturnType<typeof scanTsconfig>,
  docker: ReturnType<typeof scanDocker>,
  github: ReturnType<typeof scanGithubActions>,
): UnknownArea[] {
  const unknowns: UnknownArea[] = [];
  const hasBalena = existsSync(join(repoRoot, "balena.yml"));

  if (github.workflows.length === 0) {
    unknowns.push({
      area: "CI/CD",
      description: "No CI/CD configuration detected in this repository",
      reason: hasBalena
        ? "No .github/workflows/ directory or workflow files found. Device-fleet deployment evidence exists in balena.yml."
        : "No .github/workflows/ directory or workflow files found",
    });
  }

  if (docker.technologies.length === 0) {
    unknowns.push({
      area: "Containerization",
      description: "No Dockerfile or docker-compose configuration found in this repository",
      reason: "No Dockerfile or docker-compose files detected at repository root",
    });
  }

  if (pkg.runtime.length === 0) {
    unknowns.push({
      area: "Runtime",
      description: "Could not determine application runtime",
      reason: "No package.json found",
    });
  }

  if (ts.languages.length === 0 && pkg.languages.length === 0) {
    unknowns.push({
      area: "Language Configuration",
      description: "Could not determine language or compiler configuration",
      reason: "No tsconfig.json or language-specific configuration found",
    });
  }

  const supportingDocs = [
    existsSync(join(repoRoot, "AGENTS.md")) ? "AGENTS.md" : null,
    existsSync(join(repoRoot, "DATA_INVENTORY.md")) ? "DATA_INVENTORY.md" : null,
  ].filter(Boolean) as string[];

  unknowns.push({
    area: "Architecture Rationale",
    description: supportingDocs.length > 0
      ? "Engineering rationale for architectural decisions is not documented in the deterministic model"
      : "Engineering rationale for architectural decisions is not documented",
    reason: supportingDocs.length > 0
      ? `No ADR (Architecture Decision Records) found. Repository contains ${supportingDocs.join(", ")} as human-authored supporting documentation; the deterministic model does not interpret those files as architecture.`
      : "No ADR (Architecture Decision Records) or design documents found in repository",
  });

  unknowns.push({
    area: "Performance Characteristics",
    description: "Runtime performance characteristics and capacity limits are unknown",
    reason: "Performance data cannot be determined from static repository analysis",
  });

  const securityDoc = existsSync(join(repoRoot, "SECURITY_AUDIT.md")) ? "SECURITY_AUDIT.md" : null;
  unknowns.push({
    area: "Security Model",
    description: "Complete security model and threat assessment are not deterministically modeled",
    reason: securityDoc
      ? `Security behavior is not deterministically modeled; repository contains ${securityDoc} as human-authored supporting documentation.`
      : "Security documentation would require dedicated audit beyond static file scanning",
  });

  return unknowns;
}

export { scanPackageJson } from "./packageJson.js";
export { scanTsconfig } from "./tsconfig.js";
export { scanDocker } from "./docker.js";
export { scanGithubActions } from "./github.js";
export { scanSystemd } from "./systemd.js";
export { scanEnvironment } from "./environment.js";
export { scanDatabase } from "./database.js";
export { scanSourceImports } from "./sourceImports.js";
export { isExcluded } from "./exclusions.js";
export {
  buildInternalImportGraph,
  buildExternalIntegrationRelationships,
  buildDatastoreRelationships,
  detectLocalConstantIntegrations,
} from "./relationships.js";
export { normalizeExternalEntities } from "./normalize.js";
export { EMPTY_COVERAGE };
