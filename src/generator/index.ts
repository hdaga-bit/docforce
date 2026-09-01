import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { SystemModel } from "../model/types.js";
import type { DocforceConfig } from "../config/types.js";
import { ARTIFACT_REGISTRY } from "../update/artifactRegistry.js";

export interface GenerationResult {
  readonly files: readonly GeneratedFile[];
}

export interface GeneratedFile {
  readonly path: string;
  readonly bytes: number;
}

export function generateAllDocs(
  repoRoot: string,
  config: DocforceConfig,
  model: SystemModel,
): GenerationResult {
  const files: GeneratedFile[] = [];

  for (const artifact of ARTIFACT_REGISTRY) {
    const relativePath = artifact.getPath(config);
    const content = artifact.generate(model, config);
    const absPath = resolve(repoRoot, relativePath);
    ensureDir(absPath);
    writeFileSync(absPath, content, "utf-8");
    files.push({ path: relativePath, bytes: Buffer.byteLength(content) });
  }

  return { files };
}

function ensureDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

export { generateTechnicalOverview } from "./technicalOverview.js";
export { generateTechnologyInventory } from "./technologyInventory.js";
export { generateArchitectureDiagram, generateArchitectureOverview, generateDependencyGraph } from "./architectureDiagram.js";
export {
  generateSystemOverview,
  generateSoftwareArchitecture,
  generateDeploymentArchitecture,
  generateDataArchitecture,
  generateDeviceArchitecture,
} from "./architectureViews.js";
export { generateApiInventory } from "./apiInventory.js";
export { generateConfigurationInventory } from "./configurationInventory.js";
export { generateTechnicalArchitecture } from "./technicalArchitecture.js";
export { generateArchitectureEvidence } from "./architectureEvidence.js";
