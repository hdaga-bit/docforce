# DocForce

Standalone documentation analysis framework. Version **1.3.1**.

DocForce reads a consumer repository as filesystem and Git **data**. It builds a
deterministic architecture model, regenerates owned documentation, optionally
asks an AI reviewer for behavioural concerns, and reports pull-request
documentation status. It does not import the consumer's runtime classes.

MaryForce is Consumer #1. The next expected consumer is a separate product
repository (for example PAT), onboarded with its own `docforce.yml`. This
package does not contain PAT-specific or medical-device concepts.

## Trust model

| Class | Who owns it | Used as fact? |
|-------|-------------|----------------|
| Deterministic | Scanners + model + generators | Yes, evidence-backed |
| AI interpretation | Reviewer / writer providers | No — labelled, reviewable |
| Human / unknown | People | Required when the repo does not establish the claim |

DocForce must not invent architecture, technologies, or rationale. Unknowns stay
unknowns.

## What it is not

- Not an autonomous documentation writer
- Not a merge bot
- Not a multi-repo control plane
- Not a hardware or medical-device model
- Not production-validated against a live Claude CLI in v1.0

## Installation

v1.0 is **private**. It is not published to a public registry.

See `INSTALL.md` for the consumer contract.

v1.3.1 is consumed as a **packed tarball** (or, later, a private Git tag/SHA).
A sibling `file:../docforce` path is not required.

```bash
npm install ./vendor/docforce/mary-docforce-1.3.1.tgz
```

A git URL is acceptable once this repository has a remote. This tree currently
has none — do not invent a host or organization. Do not publish publicly
unless that is explicitly requested.

After install, the `docforce` binary is on PATH via npm:

```bash
docforce analyze
docforce generate
docforce impact -- --base origin/main
docforce update -- --base origin/main
docforce review -- --base origin/main
docforce draft -- --base origin/main
docforce apply-proposal -- --proposal <id>
docforce pr-check -- --base origin/main --no-publish
```

Consumers may keep npm wrappers (`npm run docforce:update`) that call this CLI.

## Configuration (`docforce.yml`)

`docforce.yml` belongs to the **consumer repository**. DocForce never ships
product names, component display names, AI-assisted targets, or PR policy for a
specific product.

Minimum:

```yaml
product:
  name: Example
  type: application
  description: What this repository is

scanning:
  rootDir: "."
  include:
    - "src/**"
    - "package.json"
  exclude:
    - "node_modules/**"
    - "dist/**"
    - ".git/**"

analysis:
  exclude: []

output:
  systemModel: ".docforce/system-model.json"
  docs:
    technicalOverview: "docs/generated/technical-overview.md"
    technologyInventory: "docs/generated/technology-inventory.md"
    architectureDiagram: "docs/generated/architecture.mmd"
    dependencyGraph: "docs/generated/dependency-graph.mmd"
    architectureEvidence: "docs/generated/architecture-evidence.md"
    technicalArchitecture: "docs/generated/technical-architecture.md"
```

Optional consumer blocks: `architecture.components`, `documentation.aiAssisted`,
`documentation.allowedRoots`, `ai.claude.command`, `pr`.

## Commands

| Command | Writes product docs? | Notes |
|---------|----------------------|--------|
| `analyze` | No | Scan + model + validate |
| `generate` | Yes (deterministic artifacts only) | Requires a valid model |
| `impact` | No | Base/head comparison |
| `update` | Only with `--apply` | Deterministic artifacts |
| `review` | No | AI reviewer if triggered |
| `draft` | No | Writes proposal files under `.docforce/` |
| `apply-proposal` | Only with `--apply` | Human-approved section apply |
| `pr-check` | No | Report only; `--no-publish` is local |

`.docforce/` is generated state. It is not product source.

## Generated documentation

Deterministic artifacts are regenerated from the model. They must not be edited
as if they were authored prose. Content is evidence-backed. Moving DocForce
into this package must not itself rewrite consumer docs.

## AI reviewer and proposals

AI review runs only when existing trigger rules say it is useful (or `--ai-review`).
It is skipped for generated-doc-only, DocForce-internal, and test-only changes
by default.

Proposals are never applied by `pr-check`. Application requires an explicit
`apply-proposal --apply` after a human reviews the stored proposal.

## PR workflow

`docforce pr-check` produces a `PullRequestDocumentationAssessment` and may
publish a GitHub Check. It does not update docs, apply proposals, commit, push,
merge, or approve.

Local preview:

```bash
docforce pr-check --base origin/main --head HEAD --no-publish
```

Writes `.docforce/reports/pr-assessment.md`.

Fork pull requests: DocForce will not use a repository write token in an
untrusted context and does not use `pull_request_target`. If Checks cannot be
published safely, results go to the job summary.

## Provider configuration

```bash
export DOCFORCE_AI_PROVIDER=claude   # or fake | none
export DOCFORCE_CLAUDE_PATH=/path/to/claude
```

Or in the consumer `docforce.yml`:

```yaml
ai:
  provider: claude
  claude:
    command: claude
```

Discovery uses PATH / `DOCFORCE_CLAUDE_PATH` / `ai.claude.command`. It does not
search MaryForce installation directories.

## Security boundaries

- Repository text is untrusted data, not instructions
- AI prompts keep explicit untrusted-evidence markers
- Secret-like values are redacted before provider calls
- Tokens are never written into assessments or logs
- Git invocations use argument arrays for ref/path data where the PR adapter
  talks to GitHub; artifact reads use `execFile`

## Limitations (v1.0)

- Live Claude CLI has not been smoke-tested in this environment
- Technology catalogs remain generic detectors; unmapped production dependencies
  are recorded as `category: dependency` without extra semantics
- Device vocabulary is small and evidence-backed (serial, USB path, media
  devices, Balena fleet). It is not a hardware or medical-device ontology
- `scanning.include` is the scan contract; exclusions still apply

See `docs/COMPONENT_BOUNDARIES.md`, `docs/MODEL_SCHEMA_1.0.md`, and `docs/VIEW_MODEL.md`.

## Package identity

| Field | Value |
|-------|--------|
| Name | `@mary/docforce` |
| Version | `1.3.1` |
| Publish | private / local `file:` or git dependency |
| Model schema | `1.0.0` (fingerprint-relevant; independent of package version) |

Consumers should read `DOCFORCE_VERSION` / `DOCFORCE_PACKAGE_NAME` from the
package. MaryForce does not own DocForce version strings.
