import { relative, resolve, normalize } from "node:path";
import type { DocforceConfig, DocforceAiAssistedTarget } from "../config/types.js";
import type { DocumentationArea } from "../review/types.js";
import { DOCUMENTATION_AREAS } from "../review/types.js";

export type DocumentOwnership = "deterministic" | "ai-assisted" | "human";

export function isDeterministicOwnedPath(path: string, config: DocforceConfig): boolean {
  const normalized = path.replace(/\\/g, "/");
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
  const normalized = path.replace(/\\/g, "/");
  return config.documentation.aiAssisted.find(
    (t) => t.path.replace(/\\/g, "/") === normalized && t.sectionId === sectionId,
  );
}

export function classifyPathOwnership(path: string, config: DocforceConfig): DocumentOwnership {
  if (isDeterministicOwnedPath(path, config)) return "deterministic";
  if (config.documentation.aiAssisted.some((t) => t.path === path.replace(/\\/g, "/"))) {
    return "ai-assisted";
  }
  return "human";
}

export function isPathWithinAllowedRoots(
  repoRoot: string,
  path: string,
  allowedRoots: readonly string[],
): boolean {
  const normalized = path.replace(/\\/g, "/");
  if (normalized.includes("..") || normalized.startsWith("/") || normalized.startsWith("~")) {
    return false;
  }
  const full = resolve(repoRoot, normalized);
  const rel = relative(repoRoot, full).replace(/\\/g, "/");
  if (rel.startsWith("..") || normalize(rel) !== rel.replace(/\\/g, "/")) {
    return false;
  }
  const roots = allowedRoots.length > 0 ? allowedRoots : ["docs/"];
  return roots.some((root) => {
    const r = root.replace(/\\/g, "/").replace(/^\.\//, "");
    return rel === r.replace(/\/$/, "") || rel.startsWith(r.endsWith("/") ? r : `${r}/`);
  });
}

export function isKnownDocumentationArea(area: string): area is DocumentationArea {
  return (DOCUMENTATION_AREAS as readonly string[]).includes(area);
}
