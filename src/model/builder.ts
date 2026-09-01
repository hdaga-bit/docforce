import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { basename } from "node:path";
import type { DocforceConfig } from "../config/types.js";
import { DOCFORCE_VERSION, MODEL_SCHEMA_VERSION } from "../version.js";
import type {
  SystemModel,
  GenerationMetadata,
  GitInfo,
  ProductInfo,
  RuntimeInfo,
  LanguageInfo,
  TechnologyInfo,
  ComponentInfo,
  DatastoreInfo,
  IntegrationInfo,
  InfrastructureInfo,
  WorkflowInfo,
  Relationship,
  UnknownArea,
  Evidence,
  ApiRouteInfo,
  DeviceInfo,
  DiscoveryCoverage,
} from "./types.js";

export const EMPTY_COVERAGE: DiscoveryCoverage = {
  typescriptJavascriptRoots: 0,
  pythonRoots: 0,
  apiRoutes: 0,
  composeServices: 0,
  composeVolumes: 0,
  deviceEvidence: 0,
  unsupportedEvidence: [],
};

export interface ScanResults {
  runtime: RuntimeInfo[];
  languages: LanguageInfo[];
  technologies: TechnologyInfo[];
  components: ComponentInfo[];
  datastores: DatastoreInfo[];
  integrations: IntegrationInfo[];
  infrastructure: InfrastructureInfo[];
  workflows: WorkflowInfo[];
  relationships: Relationship[];
  unknowns: UnknownArea[];
  apiRoutes: ApiRouteInfo[];
  devices: DeviceInfo[];
  coverage: DiscoveryCoverage;
}

function gitExec(cmd: string, cwd: string): string | null {
  try {
    return execSync(cmd, {
      cwd,
      encoding: "utf-8",
      timeout: 5_000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim() || null;
  } catch {
    return null;
  }
}

export function getGitInfo(repoRoot: string): GitInfo {
  const commitSha = gitExec("git rev-parse HEAD", repoRoot);
  const branch = gitExec("git rev-parse --abbrev-ref HEAD", repoRoot);

  let dirty: boolean | null = null;
  if (commitSha !== null) {
    const status = gitExec("git status --porcelain", repoRoot);
    dirty = status !== null ? status.length > 0 : null;
  }

  return { commitSha, branch, dirty };
}

function computeConfigHash(configPath: string): string {
  try {
    const content = readFileSync(configPath, "utf-8");
    return createHash("sha256").update(content).digest("hex").slice(0, 16);
  } catch {
    return "unknown";
  }
}

export function buildMetadata(
  repoRoot: string,
  configPath: string,
): GenerationMetadata {
  return {
    schemaVersion: MODEL_SCHEMA_VERSION,
    docforceVersion: DOCFORCE_VERSION,
    repositoryName: basename(repoRoot),
    repositoryRoot: repoRoot,
    git: getGitInfo(repoRoot),
    generatedAt: new Date().toISOString(),
    configHash: computeConfigHash(configPath),
  };
}

export function buildProductInfo(config: DocforceConfig): ProductInfo {
  return {
    name: config.product.name,
    type: config.product.type,
    description: config.product.description,
  };
}

/**
 * Apply configuration-provided component overrides (displayName, role).
 * Evidence for config-provided values is marked as "configuration" rather
 * than "source-code" observation.
 */
export function applyComponentOverrides(
  components: ComponentInfo[],
  config: DocforceConfig,
): ComponentInfo[] {
  const overrides = config.architecture?.components ?? {};

  return components.map((comp) => {
    const override = overrides[comp.id];
    if (!override) return comp;

    const configEvidence: Evidence = {
      sourceFile: "docforce.yml",
      evidenceType: "configuration",
      detail: `Component override for ${comp.id}`,
    };

    return {
      ...comp,
      displayName: override.displayName ?? comp.displayName,
      role: override.role ?? comp.role,
      provenance: override.displayName || override.role
        ? {
            ...comp.provenance,
            evidence: [...comp.provenance.evidence, configEvidence],
          }
        : comp.provenance,
    };
  });
}

export function buildSystemModel(
  repoRoot: string,
  configPath: string,
  config: DocforceConfig,
  scanResults: ScanResults,
): SystemModel {
  const enhancedComponents = applyComponentOverrides(scanResults.components, config);

  return {
    metadata: buildMetadata(repoRoot, configPath),
    product: buildProductInfo(config),
    runtime: scanResults.runtime,
    languages: scanResults.languages,
    technologies: scanResults.technologies,
    components: enhancedComponents,
    datastores: scanResults.datastores,
    integrations: scanResults.integrations,
    infrastructure: scanResults.infrastructure,
    workflows: scanResults.workflows,
    relationships: scanResults.relationships,
    unknowns: scanResults.unknowns,
    apiRoutes: scanResults.apiRoutes ?? [],
    devices: scanResults.devices ?? [],
    coverage: scanResults.coverage ?? EMPTY_COVERAGE,
  };
}
