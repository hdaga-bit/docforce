# Professional publication (DocForce v1.4)

Package version `1.4.1`. System Model schema remains `1.0.0`.

Publication is downstream of the v1.3 Documentation View Model. It does not
add scanners, rewrite the System Model, or invent architecture rationale.

```
Validated System Model
  → Documentation View Model
  → Publication Model
  → professionally styled DOCX / PDF
```

Generated Markdown under `docs/generated/**` remains the living engineering
source. DOCX and PDF are professional deliverables.

## Commands

```bash
docforce publish --format docx
docforce publish --format pdf
docforce publish --format all
docforce publish --output-dir docs/published
docforce publish --check-renderer
```

Publishing does not call an AI provider and does not require an API key.

## Git policy

`docs/published/**` is gitignored by default.

DOCX/PDF are build/release artifacts. Binary files may include library
metadata that is not byte-for-byte stable. The deterministic sources stay
under `docs/generated/**`. A consumer may override this later if they want
to commit deliverables.

`.docforce/publication/` is ephemeral staging (HTML, rendered diagram
assets). It is not committed. Mermaid `.mmd` sources are never overwritten.

## Content determinism vs binary hashes

The Publication Model and the textual/structural content derived from it
are deterministic for a given System Model and `publication` config.

DOCX/PDF binaries may still differ across renderer versions because of
library metadata. Do not treat file hashes as a correctness signal.

## Chromium prerequisite

Diagram rendering and PDF generation use Playwright Chromium. This is
server-safe and does not depend on a product-specific browser container.

```bash
npx playwright install chromium
# or
npm run playwright:install
```

Works on Windows development machines and Linux/VPS CI. If Chromium is
missing, publication fails with that install hint.

`docforce publish --check-renderer` diagnoses the browser without publishing.

`docforce try` and `docforce run` skip DOCX/PDF when Chromium is missing
instead of failing analysis. They print the install hint above.

## Word table of contents

The DOCX includes a Word TOC field over heading levels 1–2. Microsoft Word
(or a compatible client) may need a field refresh to populate page numbers.
The file opens cleanly before refresh.

## Configuration

Optional `publication` block in the consumer `docforce.yml`. Defaults are
professional and product-neutral — no Mary- or PAT-specific branding.

```yaml
publication:
  organization:
    name: Example Organization
    logo: docs/assets/logo.png
  document:
    title: Technical Architecture & Design Document
    classification: Internal
    status: Current
  theme:
    primaryColor: "#1B365D"
    accentColor: "#2B6CB0"
    pageSize: A4
  footer:
    text: Example Organization
```

Logo paths must stay inside allowed documentation roots. Path traversal is
rejected.

`includeOperationalProvenance: true` is the only way to add git SHA, branch,
generation timestamp, or DocForce version. Those fields are omitted by default.

## Registry

DOCX/PDF are not System Model source artifacts. They live in
`PUBLICATION_REGISTRY`, not `ARTIFACT_REGISTRY`.
