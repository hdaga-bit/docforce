import type { SystemModel } from "../model/types.js";
import type { DocforceConfig } from "../config/types.js";
import { resolveDocsOutputPath } from "../config/types.js";
import type { ModelDomain } from "../impact/types.js";
import { generateTechnicalOverview } from "../generator/technicalOverview.js";
import { generateTechnologyInventory } from "../generator/technologyInventory.js";
import { generateArchitectureOverview, generateDependencyGraph } from "../generator/architectureDiagram.js";
import { generateArchitectureEvidence } from "../generator/architectureEvidence.js";
import {
  generateDataArchitecture,
  generateDeploymentArchitecture,
  generateDeviceArchitecture,
  generateSoftwareArchitecture,
  generateSystemOverview,
} from "../generator/architectureViews.js";
import { generateApiInventory } from "../generator/apiInventory.js";
import { generateConfigurationInventory } from "../generator/configurationInventory.js";
import { generateTechnicalArchitecture } from "../generator/technicalArchitecture.js";

export interface ArtifactDefinition {
  readonly id: string;
  readonly getPath: (config: DocforceConfig) => string;
  readonly dependsOn: readonly ModelDomain[];
  readonly generate: (model: SystemModel, config: DocforceConfig) => string;
}

export const ARTIFACT_REGISTRY: readonly ArtifactDefinition[] = [
  {
    id: "technical-overview.md",
    getPath: (config) => resolveDocsOutputPath(config.output.docs, "technicalOverview"),
    dependsOn: [
      "product",
      "technologies",
      "components",
      "integrations",
      "datastores",
      "infrastructure",
      "relationships",
      "api-routes",
      "devices",
    ],
    generate: (model, config) => generateTechnicalOverview(model, config),
  },
  {
    id: "technology-inventory.md",
    getPath: (config) => resolveDocsOutputPath(config.output.docs, "technologyInventory"),
    dependsOn: ["technologies", "integrations", "datastores", "infrastructure", "devices"],
    generate: (model, config) => generateTechnologyInventory(model, config),
  },
  {
    id: "architecture.mmd",
    getPath: (config) => resolveDocsOutputPath(config.output.docs, "architectureDiagram"),
    dependsOn: [
      "components",
      "relationships",
      "integrations",
      "datastores",
      "infrastructure",
      "devices",
      "architecture-presentation",
    ],
    generate: (model, config) => generateArchitectureOverview(model, config),
  },
  {
    id: "system-overview.mmd",
    getPath: (config) => resolveDocsOutputPath(config.output.docs, "systemOverview"),
    dependsOn: [
      "components",
      "relationships",
      "integrations",
      "datastores",
      "infrastructure",
      "devices",
      "architecture-presentation",
    ],
    generate: (model, config) => generateSystemOverview(model, config),
  },
  {
    id: "software-architecture.mmd",
    getPath: (config) => resolveDocsOutputPath(config.output.docs, "softwareArchitecture"),
    dependsOn: ["components", "relationships", "architecture-presentation", "api-routes", "infrastructure"],
    generate: (model, config) => generateSoftwareArchitecture(model, config),
  },
  {
    id: "deployment-architecture.mmd",
    getPath: (config) => resolveDocsOutputPath(config.output.docs, "deploymentArchitecture"),
    dependsOn: ["infrastructure", "relationships", "devices"],
    generate: (model, config) => generateDeploymentArchitecture(model, config),
  },
  {
    id: "data-architecture.mmd",
    getPath: (config) => resolveDocsOutputPath(config.output.docs, "dataArchitecture"),
    dependsOn: ["datastores", "relationships", "components"],
    generate: (model, config) => generateDataArchitecture(model, config),
  },
  {
    id: "device-architecture.mmd",
    getPath: (config) => resolveDocsOutputPath(config.output.docs, "deviceArchitecture"),
    dependsOn: ["devices", "relationships", "components"],
    generate: (model, config) => generateDeviceArchitecture(model, config),
  },
  {
    id: "dependency-graph.mmd",
    getPath: (config) => resolveDocsOutputPath(config.output.docs, "dependencyGraph"),
    dependsOn: ["components", "relationships"],
    generate: (model) => generateDependencyGraph(model),
  },
  {
    id: "architecture-evidence.md",
    getPath: (config) => resolveDocsOutputPath(config.output.docs, "architectureEvidence"),
    dependsOn: ["relationships", "evidence", "integrations", "datastores", "devices"],
    generate: (model) => generateArchitectureEvidence(model),
  },
  {
    id: "api-inventory.md",
    getPath: (config) => resolveDocsOutputPath(config.output.docs, "apiInventory"),
    dependsOn: ["api-routes", "components"],
    generate: (model, config) => generateApiInventory(model, config),
  },
  {
    id: "configuration-inventory.md",
    getPath: (config) => resolveDocsOutputPath(config.output.docs, "configurationInventory"),
    dependsOn: ["infrastructure"],
    generate: (model, config) => generateConfigurationInventory(model, config),
  },
  {
    id: "technical-architecture.md",
    getPath: (config) => resolveDocsOutputPath(config.output.docs, "technicalArchitecture"),
    dependsOn: [
      "product",
      "technologies",
      "components",
      "relationships",
      "api-routes",
      "datastores",
      "integrations",
      "infrastructure",
      "devices",
      "architecture-presentation",
    ],
    generate: (model, config) => generateTechnicalArchitecture(model, config),
  },
];

export function getArtifactDefinition(id: string): ArtifactDefinition | undefined {
  return ARTIFACT_REGISTRY.find((a) => a.id === id);
}
