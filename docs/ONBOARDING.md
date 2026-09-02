# Beta onboarding (DocForce v1.4.1)

Package version `1.4.1`. System Model schema remains `1.0.0`.

No new scanners. No AI. No publication-format changes.

```
install → docforce try → PDF/DOCX under .docforce/trial/
         → docforce init → docforce run
```

## Commands

| Command | Writes `docforce.yml`? | Writes product docs? |
|---------|------------------------|----------------------|
| `try` | No | Only `.docforce/trial/**` |
| `init` | Yes (starter file) | No |
| `doctor` | No | No |
| `run` | No | `.docforce/**`, `docs/generated/**`, `docs/published/**` |
| `run --no-publish` | No | Analysis + generated Markdown only |

## `docforce try`

Evaluates a repository without onboarding it.

- Infers configuration from generic repository evidence
- Does **not** write `docforce.yml`
- Does **not** write `docs/generated` or `docs/published`
- Works on a dirty Git tree
- Does not commit, push, reset, or switch branches

If Playwright Chromium is missing, analysis still completes. DOCX/PDF
publication is skipped and the terminal says:

```
Publication renderer unavailable.

Run:
`npx playwright install chromium`
```

DOCX/PDF both need rendered diagrams when figures exist, so the trial
skips both deliverables rather than emitting a partial document.

## `docforce init`

Writes a starter `docforce.yml` from repository structure (`src/`, `app/`,
`lib/`, `components/`, `services/`, `packages/`, Python service roots,
Compose, Dockerfiles, `package.json`).

Product name candidates, in order: `--name`, `package.json` name, directory
name. Description is taken from `package.json` or a simple README title,
otherwise left empty for review.

If `docforce.yml` already exists, init refuses to overwrite unless `--force`.

## `docforce doctor`

Prints READY / WARNING / ERROR for Node.js, Git, write access, config,
source roots, output paths, Chromium, and optional AI.

Missing AI is not an error. Missing Chromium is a warning: analysis still
works; PDF/diagram publication does not.

## `docforce run`

For a repository that already has `docforce.yml`:

doctor → analyze → generate → publish (`--format all`)

`--no-publish` stops after generated Markdown. AI is never invoked.
