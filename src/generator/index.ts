import { resolve } from "node:path";
import type { SystemModel } from "../model/types.js";
import type { DocforceConfig } from "../config/types.js";
import { ARTIFACT_REGISTRY } from "../update/artifactRegistry.js";
import { writeGeneratedFile } from "../path/fs.js";
import { toGeneratedText } from "../path/lineEnding.js";

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
    const content = toGeneratedText(artifact.generate(model, config));
    const absPath = resolve(repoRoot, relativePath);
    writeGeneratedFile(absPath, content);
    files.push({ path: relativePath, bytes: Buffer.byteLength(content) });
  }

  return { files };
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
