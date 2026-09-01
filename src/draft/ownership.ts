import type { DocforceConfig, DocforceAiAssistedTarget } from "../config/types.js";
import type { DocumentationArea } from "../review/types.js";
import { DOCUMENTATION_AREAS } from "../review/types.js";
import { toModelPath } from "../path/canonical.js";

export { isPathWithinAllowedRoots } from "../path/canonical.js";

export type DocumentOwnership = "deterministic" | "ai-assisted" | "human";

export function isDeterministicOwnedPath(path: string, config: DocforceConfig): boolean {
  const normalized = toModelPath(path);
  if (normalized.startsWith("docs/generated/")) return true;
  const generated = Object.values(config.output.docs);
  return generated.includes(normalized);
}

export function getAiAssistedTarget(
  config: DocforceConfig,
  area: string,
): DocforceAiAssistedTarget | undefined {
  return config.documentation.aiAssisted.find((t) => t.area === area);
}

export function findAiAssistedTarget(
  config: DocforceConfig,
  path: string,
  sectionId: string,
): DocforceAiAssistedTarget | undefined {
  const normalized = toModelPath(path);
  return config.documentation.aiAssisted.find(
    (t) => toModelPath(t.path) === normalized && t.sectionId === sectionId,
  );
}

export function classifyPathOwnership(path: string, config: DocforceConfig): DocumentOwnership {
  if (isDeterministicOwnedPath(path, config)) return "deterministic";
  if (config.documentation.aiAssisted.some((t) => toModelPath(t.path) === toModelPath(path))) {
    return "ai-assisted";
  }
  return "human";
}

export function isKnownDocumentationArea(area: string): area is DocumentationArea {
  return (DOCUMENTATION_AREAS as readonly string[]).includes(area);
}
