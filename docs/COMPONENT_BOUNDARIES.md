# Component boundary rule (DocForce v1.0)

Software components are first-level scanned source roots, not every nested folder.

## Rule

1. Each `scanning.include` pattern that names a directory (for example `app/**` or `lib/**`) is a candidate component root if that directory exists and contains source files (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`, and related).
2. If the directory basename is `src`, expand one level to immediate child directories. This preserves the historical Node/TypeScript package layout (`src/orchestrator`, `src/slack`, …).
3. Nested directories under a component root are not additional components. Route folders, Python packages, and UI screens stay inside their parent component.
4. Manifest files (`package.json`, compose files, Dockerfiles) are not components.
5. `node_modules`, `vendor`, `.docforce`, `.next`, and similar installation/generated trees never become product components, even if listed in `include`.

## Why

v0.9.1 assumed application source lived under `src/`. Repositories also use `app/`, `lib/`, `components/`, and language sidecars. The include list is the scanning contract; scanners must not hard-code a second consumer's directory names.

## What this is not

The scanner does not explode every leaf directory into a component. Fifty folders under `app/` do not become fifty components. A better generic decomposition from module/package evidence is allowed; encoding a specific product's architecture is not.
