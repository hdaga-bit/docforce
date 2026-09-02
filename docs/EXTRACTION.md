# DocForce v0.9 extraction record

## Package identity

- **Name:** `@mary/docforce`
- **Version:** `0.9.1` (distribution hardening; engine unchanged from 0.9.0)
- **Location:** `/opt/maryforce/docforce` (sibling of MaryForce `orchestrator`)
- **MaryForce dependency:** `"@mary/docforce": "file:../docforce"`
- **Publish:** not published.
- **v0.9.1 distribution:** consumers pin `mary-docforce-0.9.1.tgz` (npm pack).
  MaryForce uses `file:vendor/docforce/mary-docforce-0.9.1.tgz`.
  No git remote exists for this package; do not invent one.

`@mary/docforce` fits the Mary organization. A public `docforce` name was not
used because this release must not publish.

## Layout

```
docforce/
├── src/           # engine (former orchestrator/src/docforce)
├── schemas/
├── docs/
├── package.json
├── tsconfig.json
└── README.md
```

Module boundaries are unchanged. Tests remain colocated. MaryForce keeps
`docforce.yml`, generated docs, the example GitHub workflow, and npm wrappers.

## MaryForce-specific assumption audit

| Item | Classification | Disposition |
|------|----------------|-------------|
| `product.name: MaryForce` and component display names | CONSUMER | Stays in MaryForce `docforce.yml` |
| `includeInOverview`, AI-assisted targets, allowed roots, PR policy | CONSUMER | Stays in MaryForce `docforce.yml` |
| `analysis.exclude: src/docforce/**` | CONSUMER (legacy) | Left in MaryForce yaml so `configHash` / fingerprint stay stable. Directory is gone; exclude is a no-op. |
| `@slack/bolt`, Slack, Redis, GitHub API detectors | FRAMEWORK DEFAULT | Generic technology catalog. Not MaryForce-only. |
| `src/docforce/**` file classification | FRAMEWORK DEFAULT | Still recognized for leftover trees |
| `node_modules/`, `packages/docforce/` classification | FRAMEWORK DEFAULT | Added so installed DocForce cannot look like product source |
| `docs/generated/`, `.docforce/` | FRAMEWORK DEFAULT | Generated-documentation category |
| Preview ports, Slack runtime, task store, orchestrator classes | — | Not present in DocForce. No imports from `src/tasks`, `src/slack`, `src/claude`, `src/orchestrator`, `src/github`, `src/deployment`. |
| Claude provider path | FRAMEWORK DEFAULT | `DOCFORCE_CLAUDE_PATH` / `ai.claude.command` / PATH. Not MaryForce install dirs. |
| Validator `src/docforce/...` scanner-source paths | FRAMEWORK DEFAULT | Kept for leftover trees; `node_modules/@mary/docforce/` added |

## Dependency audit

| Package | Role |
|---------|------|
| `zod` | Runtime. AI payload and stored-proposal schemas. |
| `typescript`, `tsx`, `@types/node` | Development / tests / build. |
| Node built-ins | `fs`, `path`, `crypto`, `child_process`, `os`, `test`. |

DocForce does not depend on `@slack/bolt`, `dotenv`, or any MaryForce package.

## CLI

Binary: `docforce` → `dist/cli.js`.

MaryForce wrappers call that binary (`docforce run`, `docforce update`, …).

## Config ownership

Consumer: `docforce.yml` next to the analyzed repository root.
Framework: default output paths, default PR policy object when `pr:` is omitted,
technology catalogs, trigger rules.

## Parity baseline (MaryForce, 2026-08-31)

- Fingerprint before and after extraction: `8bba2a38e3698dcc06b2186898a6a9a80683f8df61368e47d5bd59e589f25089`
- `configHash`: `1c932347c306374a`
- Components: 12 · Relationships: 48
- Generated artifact SHA-256 values unchanged
- PR assessment: `PASS` with identical per-artifact currency

## Fingerprint / install contamination

- `docforceVersion` is excluded from the model fingerprint
- `configHash` hashes consumer `docforce.yml` bytes only
- Scanners walk the consumer `repoRoot`, not the package install path
- Adding `@mary/docforce` to consumer `package.json` does not add a mapped
  technology (it is not in the catalog)

## Live Claude readiness

| Layer | Status |
|-------|--------|
| Deterministic framework | Production-proven in MaryForce |
| AI provider abstraction | Pipeline-proven via fake/test providers |
| Live Claude | **Not smoke-tested** (no CLI / key in this environment) |

## Consumer #2 readiness

The package can be installed into another repository, given a `docforce.yml`,
and run `analyze` / `generate` / `pr-check`. Missing generic capabilities
should be discovered there. Do not add PAT-specific hardware or medical-device
schema in this release.

## v1.2.0 (Relationship Completeness & Documentation Hygiene)

Package `1.2.0`. Schema remains `1.0.0`. MaryForce (Consumer #1) stays at
**12 components / 48 relationships** and fingerprint
`8f1b6dc3b3350c89badb759c349f45c68329479e3708e3869ba77fe25f86d1c3` when no new
generic facts are present. Presentation/docs hashes may change.

New evidence types (`env-url-resolution`, `local-service-http`,
`compose-depends-on`, `firestore-operation`) support existing relationship
types. They are not a schema bump.

## v1.4.0 (Professional DOCX/PDF publication)

Package `1.4.0`. Schema remains `1.0.0`. No new scanners. Publication is
downstream of the v1.3 Documentation View Model.

Outputs: `docs/published/<Product>-Technical-Architecture.docx` and `.pdf`.
Generated Markdown under `docs/generated/**` stays the living source.
`docs/published/**` is gitignored by default.

Requires Playwright Chromium (`npx playwright install chromium`). Does not
require an AI provider.

## v1.3.1 (Cross-platform portability)

Package `1.3.1`. Schema remains `1.0.0`. Same scanners, model, and generated
artifacts as v1.3.0. Path containment, Git invocation, CLI resolution, and
generated LF line endings are platform-correct on Windows and POSIX.

## v1.3.0 (Professional Technical Architecture Document Composer)

Package `1.3.0`. Schema remains `1.0.0`. MaryForce (Consumer #1) stays at
**12 components / 48 relationships** and fingerprint
`8f1b6dc3b3350c89badb759c349f45c68329479e3708e3869ba77fe25f86d1c3` when no new
generic facts are present. Composition does not rewrite the System Model.

Flagship artifact: `docs/generated/technical-architecture.md`. Existing
generated files remain. Additive relationship type `mounts` and evidence type
`compose-volume-mount` apply only when Compose named-volume mappings exist.
Optional `http-request-path` evidence attaches to existing local-service
`calls-api` edges when a same-file path is statically available.

Deterministic composition is independent of AI-assisted narrative docs.
Validate with `DOCFORCE_AI_PROVIDER=none`.



## CI limitation

MaryForce GitHub Actions `npm ci` requires the DocForce checkout as a sibling
(`file:../docforce`). The workflow fails closed if that tree is missing. It
does not use `pull_request_target` or expose a write token to untrusted PR
code.
