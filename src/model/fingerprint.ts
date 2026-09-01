import { createHash } from "node:crypto";
import type { SystemModel } from "./types.js";

/**
 * Compute a stable SHA-256 fingerprint of the documented product model.
 *
 * Excludes volatile/operational fields that change between runs without
 * reflecting a real product change:
 *   - metadata.generatedAt, metadata.git.*, metadata.docforceVersion
 *   - provenance details (evidence ordering, line numbers)
 *   - scanner ordering artifacts
 *
 * Includes all fields that affect generated documentation content:
 *   - product, runtime, languages, technologies, components, datastores
 *   - integrations, infrastructure, workflows, relationships, unknowns
 *   - component displayName/role (presentation fields)
 *   - apiRoutes, devices, coverage (schema 1.0+)
 *   - metadata.schemaVersion (a schema bump is a fingerprint change)
 *
 * The fingerprint is deterministic: identical product models produce
 * identical fingerprints regardless of Git state, generation time,
 * or DocForce version.
 */
export function computeModelFingerprint(model: SystemModel): string {
  const canonical = canonicalizeModel(model);
  const json = JSON.stringify(canonical);
  return createHash("sha256").update(json, "utf-8").digest("hex");
}

/**
 * Shortened fingerprint for display in documentation (first 16 hex chars).
 */
export function shortFingerprint(fingerprint: string): string {
  return fingerprint.slice(0, 16);
}

function canonicalizeModel(model: SystemModel): Record<string, unknown> {
  return {
    product: model.product,
    runtime: canonicalizeNamedArray(model.runtime, "name"),
    languages: canonicalizeNamedArray(model.languages, "name"),
    technologies: canonicalizeNamedArray(model.technologies, "name"),
    components: canonicalizeComponents(model.components),
    datastores: canonicalizeNamedArray(model.datastores, "name"),
    integrations: canonicalizeNamedArray(model.integrations, "name"),
    infrastructure: canonicalizeNamedArray(model.infrastructure, "name"),
    workflows: canonicalizeNamedArray(model.workflows, "name"),
    relationships: canonicalizeRelationships(model.relationships),
    unknowns: [...model.unknowns].sort((a, b) => a.area.localeCompare(b.area)),
    apiRoutes: [...(model.apiRoutes ?? [])]
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((r) => ({ path: r.path, sourceFile: r.sourceFile, methods: [...r.methods].sort() })),
    devices: [...(model.devices ?? [])]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((d) => ({ id: d.id, kind: d.kind, name: d.name })),
    coverage: model.coverage ?? null,
    schemaVersion: model.metadata.schemaVersion,
    configHash: model.metadata.configHash,
  };
}

function canonicalizeNamedArray<T>(
  items: readonly T[],
  sortKey: keyof T & string,
): unknown[] {
  return [...items]
    .sort((a, b) => String(a[sortKey]).localeCompare(String(b[sortKey])))
    .map((item) => stripProvenance(item as unknown as Record<string, unknown>));
}

function canonicalizeComponents(
  components: readonly SystemModel["components"][number][],
): unknown[] {
  return [...components]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((c) => ({
      id: c.id,
      name: c.name,
      path: c.path,
      displayName: c.displayName,
      type: c.type,
      role: c.role,
      entryPoints: c.entryPoints ? [...c.entryPoints].sort() : undefined,
    }));
}

function canonicalizeRelationships(
  rels: readonly SystemModel["relationships"][number][],
): unknown[] {
  return [...rels]
    .sort((a, b) => {
      const k = (r: typeof a) => `${r.from}:${r.type}:${r.to}`;
      return k(a).localeCompare(k(b));
    })
    .map((r) => ({
      from: r.from,
      to: r.to,
      type: r.type,
      classification: r.classification,
    }));
}

function stripProvenance(item: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(item)) {
    if (key === "provenance" || key === "evidence" || key === "confidence" ||
        key === "derivedFrom" || key === "description") continue;
    result[key] = value;
  }
  return result;
}
