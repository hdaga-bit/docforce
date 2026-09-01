import type { IntegrationInfo, DatastoreInfo, Provenance } from "../model/types.js";

export interface NormalizedExternalEntity {
  readonly canonicalName: string;
  readonly category: "integration" | "datastore";
  readonly implementation?: string;
  readonly protocol?: string;
  readonly direction?: "inbound" | "outbound" | "bidirectional";
  readonly provenance: Provenance;
}

interface AliasRule {
  readonly patterns: RegExp[];
  readonly canonicalName: string;
  readonly category: "integration" | "datastore";
  readonly implementation?: string;
}

const ALIAS_RULES: AliasRule[] = [
  {
    patterns: [/^SQLite\b/i, /^node:sqlite$/i],
    canonicalName: "SQLite",
    category: "datastore",
    implementation: "node:sqlite",
  },
  {
    patterns: [/^PostgreSQL\b/i, /^pg$/i, /^postgres$/i],
    canonicalName: "PostgreSQL",
    category: "datastore",
  },
  {
    patterns: [/^Redis\b/i, /^ioredis$/i],
    canonicalName: "Redis",
    category: "datastore",
  },
  {
    patterns: [/^Firebase\b/i, /^Firebase Admin$/i, /^Firestore$/i],
    canonicalName: "Firebase",
    category: "datastore",
    implementation: "Firebase",
  },
  {
    patterns: [/^Slack\b/i, /^@slack\/bolt$/i],
    canonicalName: "Slack",
    category: "integration",
    implementation: "@slack/bolt",
  },
];

function findAlias(name: string): AliasRule | undefined {
  return ALIAS_RULES.find((rule) => rule.patterns.some((p) => p.test(name)));
}

/**
 * Normalize integrations and datastores, merging duplicates that represent
 * the same underlying technology. Provenance from all contributing detections
 * is preserved.
 */
export function normalizeExternalEntities(
  integrations: IntegrationInfo[],
  datastores: DatastoreInfo[],
): { integrations: IntegrationInfo[]; datastores: DatastoreInfo[] } {
  // Normalize datastores
  const dsMap = new Map<string, DatastoreInfo>();
  for (const ds of datastores) {
    if (ds.type === "migration-directory" || ds.type === "schema-definition") {
      dsMap.set(ds.name + ":" + ds.type, ds);
      continue;
    }
    const alias = findAlias(ds.name) ?? findAlias(ds.engine ?? "");
    const key = alias ? alias.canonicalName : ds.name;
    const existing = dsMap.get(key);
    if (!existing) {
      dsMap.set(key, {
        ...ds,
        name: alias?.canonicalName ?? ds.name,
        engine: alias?.implementation ?? ds.engine,
      });
    } else {
      dsMap.set(key, {
        ...existing,
        location: existing.location ?? ds.location,
        provenance: mergeProvenance(existing.provenance, ds.provenance),
      });
    }
  }

  // Normalize integrations: remove entries that were canonicalized into datastores
  const normalizedIntegrations: IntegrationInfo[] = [];

  for (const integ of integrations) {
    const alias = findAlias(integ.name);
    if (alias && alias.category === "datastore") {
      const dsKey = alias.canonicalName;
      const existingDs = dsMap.get(dsKey);
      if (existingDs) {
        dsMap.set(dsKey, {
          ...existingDs,
          provenance: mergeProvenance(existingDs.provenance, integ.provenance),
        });
      } else {
        dsMap.set(dsKey, {
          name: alias.canonicalName,
          type: "embedded-database",
          engine: alias.implementation,
          provenance: integ.provenance,
        });
      }
    } else {
      normalizedIntegrations.push(integ);
    }
  }

  return {
    integrations: normalizedIntegrations,
    datastores: Array.from(dsMap.values()),
  };
}

function mergeProvenance(a: Provenance, b: Provenance): Provenance {
  return {
    kind: a.kind === "observation" || b.kind === "observation" ? "observation" : a.kind,
    confidence: a.confidence === "high" || b.confidence === "high" ? "high" : a.confidence,
    evidence: [...a.evidence, ...b.evidence],
    reasoning: a.reasoning || b.reasoning || undefined,
  };
}

export { findAlias, ALIAS_RULES };
