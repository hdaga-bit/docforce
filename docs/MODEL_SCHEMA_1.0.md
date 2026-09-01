# System Model schema 1.0.0

Package version `1.3.1` and System Model schema version `1.0.0` are independent numbers.

| Version | What it means |
|---------|----------------|
| `@mary/docforce` 1.3.1 | Tool / npm package (Professional Technical Architecture Document Composer) |
| `metadata.schemaVersion` 1.0.0 | Public `SystemModel` shape (unchanged from v1.0 / v1.1 / v1.2) |

v1.2 adds relationship *instances* under existing types (`calls-api` to
`infra:` local services, Compose `depends-on`, datastore `reads-from` /
`writes-to`, software-to-service `deploys`). Relationship endpoints may use
existing `infra:<compose-service>` ids; the validator recognizes those
infrastructure entities as nodes.

v1.3 adds an additive relationship type `mounts` (Compose service → named
volume, with static target path when present) and optional `http-request-path`
evidence on existing `calls-api` edges. These are backward-compatible: older
models remain valid; consumers without named Compose volumes gain no new
relationship instances. `MODEL_SCHEMA_VERSION` stays `1.0.0` so the
fingerprint of schema-stable consumers (MaryForce) does not change when no new
facts are found.

The model fingerprint includes `metadata.schemaVersion`. Bumping the schema therefore changes fingerprints even when product architecture is unchanged. Treat that as a schema event, not a product-semantic change.



## Additive fields (v0.7 → v1.0)

Existing v0.7 models remain readable: missing fields default to empty.

| Field | Purpose |
|-------|---------|
| `apiRoutes` | Next.js App Router `app/api/**/route.*` handlers |
| `devices` | Generic device / peripheral / interface evidence |
| `coverage` | Scanner coverage counts (not documentation completeness) |

New relationship types: `runs-on`, `attached-to`, `communicates-over`.

MaryForce (Consumer #1) models remain valid. After regenerating with 1.0.0, expect:

- Same components and software relationships unless a documented scanner improvement applies
- A new fingerprint driven by schema 1.0.0 plus any real new findings
- Generated-doc churn only where new non-empty sections or generic inventory apply
