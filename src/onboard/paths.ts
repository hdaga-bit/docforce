import { resolve } from "node:path";
import { isPathInsideRoot, toModelPath } from "../path/canonical.js";
import type { DocforceConfig } from "../config/types.js";

export const RUN_WRITE_ROOTS = [".docforce", "docs/generated", "docs/published"] as const;
export const TRIAL_WRITE_ROOT = ".docforce/trial";

export function assertAllowedWritePath(repoRoot: string, relativePath: string, roots: readonly string[]): void {
  const abs = resolve(repoRoot, relativePath);
  const allowed = roots.some((root) => isPathInsideRoot(resolve(repoRoot, root), abs) || isPathInsideRoot(resolve(repoRoot, root), resolve(abs, ".")));
  const model = toModelPath(relativePath);
  const prefixed = roots.some((root) => model === root || model.startsWith(`${root}/`));
  if (!allowed && !prefixed) {
    throw new Error(`Refusing to write "${relativePath}" outside ${roots.join(", ")}`);
  }
}

export function collectConfiguredWritePaths(config: DocforceConfig): string[] {
  return [
    config.output.systemModel,
    config.output.docs.technicalOverview,
    config.output.docs.technologyInventory,
    config.output.docs.architectureDiagram,
    config.output.docs.dependencyGraph ?? "docs/generated/dependency-graph.mmd",
    config.output.docs.architectureEvidence,
    config.output.docs.systemOverview ?? "docs/generated/system-overview.mmd",
    config.output.docs.softwareArchitecture ?? "docs/generated/software-architecture.mmd",
    config.output.docs.deploymentArchitecture ?? "docs/generated/deployment-architecture.mmd",
    config.output.docs.dataArchitecture ?? "docs/generated/data-architecture.mmd",
    config.output.docs.deviceArchitecture ?? "docs/generated/device-architecture.mmd",
    config.output.docs.apiInventory ?? "docs/generated/api-inventory.md",
    config.output.docs.configurationInventory ?? "docs/generated/configuration-inventory.md",
    config.output.docs.technicalArchitecture ?? "docs/generated/technical-architecture.md",
    config.publication?.outputDir ?? "docs/published",
  ];
}
