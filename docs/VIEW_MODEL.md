# Documentation View Model (DocForce v1.3)

Package version `1.4.0`. System Model schema remains `1.0.0`.

v1.3 composes a professional flagship Technical Architecture document from the
validated System Model and Documentation View Model. It does not expand
repository discovery substantially. Presentation grouping, volume-mount
evidence, and provenance hygiene are in scope.

```
Repository → System Model → Documentation View Model → modular artifacts
           → technical-architecture.md (flagship)
           → Publication Model → DOCX / PDF (v1.4, downstream)
```

The System Model stays evidence-rich and exhaustive. v1.3 composition does
not rewrite discovered facts. `mounts` is an additive relationship type for
Compose named-volume mappings; `MODEL_SCHEMA_VERSION` stays `1.0.0` so
consumers without those mappings keep the same fingerprint.

Presentation never rewrites discovered facts. Consumer overrides
(`documentation.technologyOverrides`, `documentation.componentOverrides`,
`architecture.components.presentation`) affect generated documents only.

## Local service HTTP relationships

A Compose service existing is not enough. A `calls-api` edge to
`infra:<service>` requires same-file evidence that software performs an HTTP
call whose destination resolves to that service via:

- a literal / default URL hostname matching a Compose service
- a Compose environment-variable URL value
- a loopback URL whose port matches a published Compose port
- `{SERVICE}_URL` / `{SERVICE}_HOST` / `{SERVICE}_ENDPOINT` naming **and** an HTTP call

Same-file/simple-value propagation only. No general data-flow analysis.

`depends_on` becomes a deployment `depends-on` between `infra:` service ids.
It is never promoted into a software call.

When a software component and a Compose service share a name, they remain
distinct entities. The overview keeps the software node in Application /
Software and labels the service `name service` so the rendered view does not
collide. A `deploys` relationship records the mapping.

## Datastore operations

SDK installation does not create a datastore edge. Reads and writes require
operation evidence (Firestore `setDoc` / `getDoc` / `.set(` / `.get(`,
`localStorage.getItem` / `setItem`, IndexedDB `put` / `get`, …).

A named Firebase/Firestore database id is `DatastoreInfo.location` on the
single Firebase entity.

## Technology presentation taxonomy


Deterministic classes:

| Class | Typical evidence |
|---|---|
| `core-platform` | Application platform packages such as `next` |
| `language-runtime` | Languages, Node/Python runtimes, language packages |
| `framework` | React, Express, Flask, and `category: framework` |
| `datastore` | Database libraries and packages tied to discovered datastores |
| `infrastructure` | Docker, Compose, Balena, `containerization`, `device-fleet` |
| `external-integration` | Messaging SDKs and packages matching discovered integrations |
| `capability-library` | Domain capability packages (payments including `@paystack/*`, media, PDF, QR, validation, charts, analytics, generic audio/AI libraries) |
| `supporting-library` | Known UI primitive families (`@radix-ui/*`, `clsx`, animation libraries, …) |
| `development-tool` | `devDependency` provenance **unless** non-test source imports the package, tooling/testing/lint, `@types/*` |
| `unknown-dependency` | Unmapped production dependencies |

`devDependencies` are demoted by default. UI primitive libraries are demoted. Framework/runtime/datastore/integration-tied packages are elevated. The full appendix still lists every technology with evidence.

## Component presentation

Tiers: `primary`, `supporting`, `utility`, or `neutral` when confidence is inadequate.

Signals: relationship degree, entry points, App Router API routes under the component path, matching compose service names, `includeInOverview: false` → utility. Folder names alone do not imply importance.

Where evidence supports it, a short deterministic summary is attached (API route counts, Compose/fleet mapping, datastore or HTTP usage). Summaries never invent business purpose from folder names.

## Configuration hygiene

High-level technical documentation summarizes environment-variable *names*
(count and generic areas such as service URLs, credentials, timeouts). Complete
names are listed in `docs/generated/configuration-inventory.md`. Secret values
are never documented.

Repeated container images with the same name/tag are aggregated in high-level
views (usage count and source files). Distinct tags stay distinct.

Generic, unambiguous hostname labels may be shown as `Resend API (api.resend.com)`.
The canonical host remains in the System Model. Unmapped hosts stay as hosts.

## API grouping

App Router routes are grouped by the first path segment after `/api/`. `/api/voice/stt` → group `voice`. Groups are repository path segments, not invented product concepts.

`docs/generated/api-inventory.md` lists route, HTTP methods, source file, and a related component only when the source file sits under that component path.

The Technical Overview and the flagship Technical Architecture document
summarize counts/groups and link to the inventory.

## Architecture views

Specialized views are generated when evidence exists:

| Artifact | Contents |
|---|---|
| `technical-architecture.md` | Flagship composed document. Conditional sections only. Embeds high-level diagrams. Links to inventories instead of duplicating them. |
| `system-overview.mmd` | Entity-type categories with high-level grouping. Software stays in Application even when a Compose service shares the name. Fleet/device target has one primary overview node. Supporting libraries are omitted. |
| `software-architecture.mmd` | Software components, evidenced internal/runtime edges, collapsed local API (`N routes / M groups`), local services that are HTTP call targets. |
| `deployment-architecture.mmd` | Compose/systemd services, volumes, `mounts` mappings, networks, fleet targets, evidence-backed depends_on/runs-on/deploys. Volumes are never equivalent to services. |
| `data-architecture.mmd` | Datastores; persist/read/write edges only if evidenced. A datastore may appear with no edge. |
| `device-architecture.mmd` | Device/fleet, communication interfaces, peripherals, and relevant software connections. Compose services are not repeated as device-service peers. |
| `configuration-inventory.md` | Complete Compose environment-variable *names*, grouped by generic area. |

`architecture.mmd` is the Consumer #1-compatible system overview.

`dependency-graph.mmd` and `architecture-evidence.md` remain detailed engineering artifacts.

## Flagship document (v1.3)

`docs/generated/technical-architecture.md` is the primary engineer/stakeholder
document. Existing generated files remain supporting evidence.

Sections are included only when the consumer model supports them:

1. Executive Technical Summary
2. System Context
3. Architecture Overview
4. Software Architecture
5. Technology Stack
6. Local API Architecture
7. Data Architecture
8. External Integrations
9. Device & Peripheral Architecture
10. Deployment Architecture
11. Runtime Configuration
12. Documentation Coverage
13. Known Technical Gaps / Unknowns
14. Appendices / Supporting Artifacts

Software identity, Compose/service identity, and fleet/runtime target remain
distinct System Model entities. The flagship document presents them as related
views of the same implementation, not as unrelated peers.

The document is deterministic: no timestamps, Git SHAs, branches, or DocForce
version. Operational provenance stays under `.docforce` reports.

Architecture selection rationale is never generated from industry knowledge.
When no structured ADR/rationale evidence exists, the document states that it
is not currently available as structured, validated repository evidence.

This composer is separate from AI-assisted narrative documentation
(v0.5–v0.7). Validate with `DOCFORCE_AI_PROVIDER=none`.

## High-level grouping (presentation only)

The System Model is unchanged. High-level diagrams and the flagship document
may collapse:

- Local API routes → one node such as `23 routes / 15 groups`
- Related external integrations sharing a deterministic family (file-host
  endpoints, email APIs) when two or more members are present
- Supporting libraries → omitted from architecture diagrams; listed in
  `technology-inventory.md`

Canonical endpoints remain in the detailed integration inventory and evidence.

A device-fleet infrastructure entity is the primary high-level representation
of that fleet/device target. The same entity is not repeated under Device /
Peripherals in the system overview.

Device views emphasize device/fleet → interfaces/peripherals → software
connections. Deployment views own container/service topology.

## Volume mounts (v1.3)

When Compose maps a service to a **named** volume declared in the Compose
`volumes:` section, a `mounts` relationship is recorded:

`infra:<service>` → `mounts` → `infra:<volume>`

Relationship evidence includes the static mount target path when Compose
declares it. Bind mounts and running-container inspection are out of scope.

`mounts` is an additive relationship type. `MODEL_SCHEMA_VERSION` stays
`1.0.0` so consumers without named Compose volumes keep the same fingerprint.

## Optional HTTP path evidence

When same-file local-service HTTP detection can resolve a request path
(for example `` `${LITERT_URL}/v1/chat` ``), that path is stored as
relationship metadata/evidence (`http-request-path`). The `calls-api`
relationship exists whether or not a path is resolved. Full URL/data-flow
analysis is out of scope.

## Provenance

Inference relationships must reference valid evidence or relationship ids in
`derivedFrom`, or be classified as observations when directly supported by
Compose/source evidence. Empty `derivedFrom` on inferences is a validation
warning and is not suppressed.


## Insufficient-view policy (B)

Specialized views are **always emitted**. If evidence is insufficient, the artifact is a commented unavailable document — not an empty `graph TD`.

Always emitting the file keeps deterministic update and PR currency hashing stable: the artifact path exists, has a hash, and regenerates to the same marker until evidence appears.

## Coverage wording

The Technical Overview includes **Documentation Coverage & Unknowns** with statuses:

- discovered
- partially represented
- unavailable from repository evidence

Wording is based on scanner coverage and unknowns. No percentages. Architecture rationale is out of scope and is not generated.

## Publication (v1.4)

The flagship Markdown remains the deterministic text source. `docforce publish`
builds a shared Publication Model from the same view and renders DOCX/PDF.
See `docs/PUBLICATION.md`.
