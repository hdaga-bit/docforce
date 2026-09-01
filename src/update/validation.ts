import { resolve, relative, normalize } from "node:path";
import type { StagedArtifact } from "./staging.js";
import { ARTIFACT_REGISTRY } from "./artifactRegistry.js";

export interface UpdateValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export function validateStagedArtifacts(
  staged: readonly StagedArtifact[],
  repoRoot: string,
): UpdateValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const registeredIds = new Set(ARTIFACT_REGISTRY.map((a) => a.id));

  for (const s of staged) {
    if (s.status === "unaffected" || s.status === "unchanged") continue;

    if (!registeredIds.has(s.artifact)) {
      errors.push(`Artifact "${s.artifact}" is not in the artifact registry`);
    }

    const fullPath = resolve(repoRoot, s.path);
    const relativePath = relative(repoRoot, fullPath);
    if (relativePath.startsWith("..") || normalize(relativePath) !== relativePath.replace(/\\/g, "/")) {
      errors.push(`Artifact "${s.artifact}" path "${s.path}" resolves outside repository root`);
    }

    if (!s.content || s.content.trim().length === 0) {
      errors.push(`Artifact "${s.artifact}" has empty content`);
    }

    if (s.artifact.endsWith(".md") && s.content) {
      if (!s.content.startsWith("#")) {
        warnings.push(`Artifact "${s.artifact}" does not start with a heading`);
      }
    }

    if (s.artifact.endsWith(".mmd") && s.content) {
      if (!s.content.includes("graph TD")) {
        warnings.push(`Artifact "${s.artifact}" does not contain expected Mermaid graph directive`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
