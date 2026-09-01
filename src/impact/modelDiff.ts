import type { SystemModel, Relationship } from "../model/types.js";
import type { ModelDelta, EntityChange, RelationshipChange, ModelDomain } from "./types.js";

/**
 * Compare two SystemModels and produce a ModelDelta.
 * Ignores volatile metadata (timestamps, git dirty state, etc.)
 */
export function compareModels(
  base: SystemModel,
  head: SystemModel,
): ModelDelta {
  const entityChanges: EntityChange[] = [];
  const relationshipChanges: RelationshipChange[] = [];

  if (base.product.name !== head.product.name ||
      base.product.type !== head.product.type ||
      base.product.description !== head.product.description) {
    entityChanges.push({
      domain: "product",
      changeType: "modified",
      name: head.product.name,
      detail: "Product metadata changed",
    });
  }

  compareNamedEntities(base.technologies, head.technologies, "technologies", (t) => t.name, entityChanges);
  compareNamedEntities(base.components, head.components, "components", (c) => c.id ?? c.name, entityChanges);
  compareNamedEntities(base.integrations, head.integrations, "integrations", (i) => i.name, entityChanges);
  compareNamedEntities(base.datastores, head.datastores, "datastores", (d) => d.name, entityChanges);
  compareNamedEntities(base.infrastructure, head.infrastructure, "infrastructure", (i) => i.name, entityChanges);
  compareNamedEntities(base.workflows, head.workflows, "workflows", (w) => w.name, entityChanges);
  compareNamedEntities(base.apiRoutes ?? [], head.apiRoutes ?? [], "api-routes", (r) => r.path, entityChanges);
  compareNamedEntities(base.devices ?? [], head.devices ?? [], "devices", (d) => d.id, entityChanges);

  compareRelationships(base.relationships, head.relationships, relationshipChanges);

  const changedDomains = new Set<ModelDomain>();
  for (const ec of entityChanges) changedDomains.add(ec.domain);
  if (relationshipChanges.length > 0) changedDomains.add("relationships");

  return {
    entityChanges,
    relationshipChanges,
    changedDomains,
    isEmpty: entityChanges.length === 0 && relationshipChanges.length === 0,
  };
}

function compareNamedEntities<T>(
  baseItems: readonly T[],
  headItems: readonly T[],
  domain: ModelDomain,
  getName: (item: T) => string,
  changes: EntityChange[],
): void {
  const baseNames = new Set(baseItems.map(getName));
  const headNames = new Set(headItems.map(getName));

  for (const name of headNames) {
    if (!baseNames.has(name)) {
      changes.push({ domain, changeType: "added", name });
    }
  }

  for (const name of baseNames) {
    if (!headNames.has(name)) {
      changes.push({ domain, changeType: "removed", name });
    }
  }

  for (const headItem of headItems) {
    const name = getName(headItem);
    if (!baseNames.has(name)) continue;
    const baseItem = baseItems.find((b) => getName(b) === name);
    if (!baseItem) continue;

    if (hasSignificantChange(baseItem, headItem)) {
      if (domain === "components" && isPresentationOnlyChange(baseItem, headItem)) {
        changes.push({
          domain: "architecture-presentation" as ModelDomain,
          changeType: "modified",
          name,
          detail: describeModification(baseItem, headItem),
        });
      } else {
        changes.push({
          domain,
          changeType: "modified",
          name,
          detail: describeModification(baseItem, headItem),
        });
      }
    }
  }
}

const PRESENTATION_FIELDS = new Set(["displayName", "role"]);

function isPresentationOnlyChange<T>(base: T, head: T): boolean {
  const b = base as Record<string, unknown>;
  const h = head as Record<string, unknown>;
  for (const key of new Set([...Object.keys(b), ...Object.keys(h)])) {
    if (key === "provenance" || key === "evidence" || key === "confidence" ||
        key === "classification" || key === "derivedFrom") continue;
    if (PRESENTATION_FIELDS.has(key)) continue;
    const bVal = JSON.stringify(b[key]);
    const hVal = JSON.stringify(h[key]);
    if (bVal !== hVal) return false;
  }
  return true;
}

function hasSignificantChange<T>(base: T, head: T): boolean {
  const bJson = normalizeForComparison(base);
  const hJson = normalizeForComparison(head);
  return bJson !== hJson;
}

function normalizeForComparison<T>(item: T): string {
  const stripped = stripVolatile(item as Record<string, unknown>);
  return JSON.stringify(stripped, Object.keys(stripped).sort());
}

function stripVolatile(obj: unknown): Record<string, unknown> {
  if (typeof obj !== "object" || obj === null) return {};
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (key === "provenance" || key === "evidence" || key === "confidence" ||
        key === "classification" || key === "derivedFrom") continue;
    if (Array.isArray(value)) {
      result[key] = [...value].sort();
    } else {
      result[key] = value;
    }
  }
  return result;
}

function describeModification<T>(base: T, head: T): string {
  const b = base as Record<string, unknown>;
  const h = head as Record<string, unknown>;
  const diffs: string[] = [];

  for (const key of Object.keys(h)) {
    if (key === "provenance" || key === "evidence") continue;
    const bVal = JSON.stringify(b[key]);
    const hVal = JSON.stringify(h[key]);
    if (bVal !== hVal) {
      diffs.push(`${key} changed`);
    }
  }

  return diffs.join(", ") || "properties changed";
}

function compareRelationships(
  baseRels: readonly Relationship[],
  headRels: readonly Relationship[],
  changes: RelationshipChange[],
): void {
  const relKey = (r: Relationship) => `${r.from}:${r.type}:${r.to}`;
  const baseKeys = new Map<string, Relationship>();
  const headKeys = new Map<string, Relationship>();

  for (const r of baseRels) baseKeys.set(relKey(r), r);
  for (const r of headRels) headKeys.set(relKey(r), r);

  for (const [key, rel] of headKeys) {
    if (!baseKeys.has(key)) {
      changes.push({
        changeType: "added",
        from: rel.from,
        to: rel.to,
        type: rel.type,
      });
    }
  }

  for (const [key, rel] of baseKeys) {
    if (!headKeys.has(key)) {
      changes.push({
        changeType: "removed",
        from: rel.from,
        to: rel.to,
        type: rel.type,
      });
    }
  }
}

export { stripVolatile, normalizeForComparison };
