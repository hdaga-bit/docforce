import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import type { DocforceConfig } from "../config/types.js";
import type { ChangeImpactReport } from "../impact/types.js";
import type { SystemModel } from "../model/types.js";
import { ARTIFACT_REGISTRY } from "../update/artifactRegistry.js";
import type {
  DeterministicArtifactAssessment,
  DeterministicDocumentationAssessment,
  DeterministicDocStatus,
} from "./types.js";

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

export interface ArtifactReader {
  /** Returns the artifact content as it exists in the assessed head state. */
  (relativePath: string): string | undefined;
}

/**
 * Read artifact content from a Git ref, or from the working tree when no ref
 * is given. Uses execFile so repository-controlled paths are never shell-parsed.
 */
export function createArtifactReader(repoRoot: string, headRef?: string): ArtifactReader {
  if (!headRef || headRef === "WORKTREE") {
    return (relativePath) => {
      const full = resolve(repoRoot, relativePath);
      return existsSync(full) ? readFileSync(full, "utf-8") : undefined;
    };
  }

  return (relativePath) => {
    try {
      return execFileSync("git", ["show", `${headRef}:${relativePath}`], {
        cwd: repoRoot,
        encoding: "utf-8",
        timeout: 10_000,
        stdio: ["pipe", "pipe", "pipe"],
        maxBuffer: 32 * 1024 * 1024,
      });
    } catch {
      return undefined;
    }
  };
}

/**
 * Answer the question "does this pull request already contain the deterministic
 * DocForce updates the product change requires?".
 *
 * This is stronger than the v0.3 notion of "affected": an affected artifact
 * whose committed content already equals the regenerated content is CURRENT.
 */
export function assessDeterministicDocs(params: {
  readonly config: DocforceConfig;
  readonly headModel: SystemModel;
  readonly impactReport: ChangeImpactReport;
  readonly readArtifact: ArtifactReader;
}): DeterministicDocumentationAssessment {
  const { config, headModel, impactReport, readArtifact } = params;
  const artifacts: DeterministicArtifactAssessment[] = [];

  for (const def of ARTIFACT_REGISTRY) {
    const impact = impactReport.documentImpacts.find((d) => d.artifact === def.id);
    const path = def.getPath(config);

    if (!impact?.affected) {
      artifacts.push({
        artifact: def.id,
        path,
        status: "unaffected",
        impactLevel: "none",
        triggeringDomains: [],
        reason: "No relevant model domains changed",
      });
      continue;
    }

    const expected = def.generate(headModel, config);
    const actual = readArtifact(path);

    let status: DeterministicDocStatus;
    let reason: string;
    if (actual === undefined) {
      status = "missing";
      reason = "Artifact is affected by this change but does not exist in the pull request";
    } else if (sha256(actual) === sha256(expected)) {
      status = "current";
      reason = "Pull request already contains the regenerated content";
    } else {
      status = "stale";
      reason = `Regenerated content differs from the version in this pull request (${impact.reason})`;
    }

    artifacts.push({
      artifact: def.id,
      path,
      status,
      impactLevel: impact.impactLevel,
      triggeringDomains: impact.triggeringDomains,
      reason,
    });
  }

  return summarize(artifacts);
}

export function summarize(
  artifacts: readonly DeterministicArtifactAssessment[],
  error?: string,
): DeterministicDocumentationAssessment {
  const affectedCount = artifacts.filter((a) => a.status !== "unaffected").length;
  const staleCount = artifacts.filter((a) => a.status === "stale").length;
  const missingCount = artifacts.filter((a) => a.status === "missing").length;

  return {
    artifacts,
    affectedCount,
    staleCount,
    missingCount,
    upToDate: staleCount === 0 && missingCount === 0,
    error,
  };
}
