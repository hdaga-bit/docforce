import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { SystemModel } from "../model/types.js";
import type { DocforceConfig } from "../config/types.js";
import type { ChangeImpactReport, DocumentImpact } from "../impact/types.js";
import type { ArtifactUpdate, ArtifactUpdateStatus } from "./types.js";
import { ARTIFACT_REGISTRY } from "./artifactRegistry.js";

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

export interface StagedArtifact {
  readonly artifact: string;
  readonly path: string;
  readonly content: string;
  readonly newHash: string;
  readonly oldHash?: string;
  readonly status: ArtifactUpdateStatus;
  readonly impact: DocumentImpact | undefined;
}

/**
 * Generate proposed artifact contents and compare with existing files.
 * Does NOT write anything to disk.
 */
export function stageArtifacts(
  repoRoot: string,
  config: DocforceConfig,
  model: SystemModel,
  impactReport: ChangeImpactReport,
): StagedArtifact[] {
  const staged: StagedArtifact[] = [];

  for (const def of ARTIFACT_REGISTRY) {
    const impact = impactReport.documentImpacts.find((d) => d.artifact === def.id);
    const isAffected = impact?.affected ?? false;

    if (!isAffected) {
      staged.push({
        artifact: def.id,
        path: def.getPath(config),
        content: "",
        newHash: "",
        status: "unaffected",
        impact,
      });
      continue;
    }

    const content = def.generate(model, config);
    const newHash = sha256(content);

    const existingPath = resolve(repoRoot, def.getPath(config));
    let oldHash: string | undefined;
    let status: ArtifactUpdateStatus;

    if (!existsSync(existingPath)) {
      status = "would-create";
    } else {
      const existingContent = readFileSync(existingPath, "utf-8");
      oldHash = sha256(existingContent);
      status = oldHash === newHash ? "unchanged" : "would-update";
    }

    staged.push({
      artifact: def.id,
      path: def.getPath(config),
      content,
      newHash,
      oldHash,
      status,
      impact,
    });
  }

  return staged;
}

export function buildArtifactUpdates(
  staged: readonly StagedArtifact[],
): ArtifactUpdate[] {
  return staged.map((s) => ({
    artifact: s.artifact,
    path: s.path,
    status: s.status,
    impactLevel: s.impact?.impactLevel ?? "none",
    triggeringDomains: s.impact?.triggeringDomains ?? [],
    oldHash: s.oldHash,
    newHash: s.status !== "unaffected" ? s.newHash : undefined,
    reason: s.status === "unaffected" ? "No relevant model domains changed"
      : s.status === "unchanged" ? "Regenerated content is identical to existing"
      : s.status === "would-create" ? "Artifact does not exist yet"
      : `Content changed (${s.impact?.reason ?? "model delta"})`,
  }));
}
