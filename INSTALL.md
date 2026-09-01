# Installing DocForce in a consumer repository

v1.3.0 is private. It is not on a public npm registry.

## What a consumer needs

1. Node.js 20 or later
2. A pinned DocForce package (packed tarball or, later, a private Git tag/SHA)
3. A `docforce.yml` at the repository root
4. Optional: generated-doc output paths, AI-assisted targets, a GitHub workflow

DocForce analyses **this repository**. It does not import the consumer's
runtime modules.

## From `npm install` to `docforce analyze`

```bash
# Pin a packed release that lives in the consumer repo
npm install ./vendor/docforce/mary-docforce-1.3.0.tgz

# Or, once a private Git remote exists (do not invent one):
# npm install git+ssh://git@<host>/<owner>/<repo>.git#v1.0.0
```

Add `docforce.yml`:

```yaml
product:
  name: YourProduct
  type: application
  description: One or two sentences about this repository

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
```

Then:

```bash
npx docforce analyze
npx docforce generate
npx docforce pr-check -- --base origin/main --no-publish
```

Optional npm wrappers:

```json
{
  "scripts": {
    "docforce": "docforce run",
    "docforce:analyze": "docforce analyze",
    "docforce:generate": "docforce generate",
    "docforce:pr-check": "docforce pr-check"
  }
}
```

## Version traceability

```js
import { formatPackageIdentity } from "@mary/docforce";
formatPackageIdentity();
// "@mary/docforce 1.0.0" or "@mary/docforce 1.0.0 (<git sha>)"
```

This identity is not part of the consumer product model fingerprint.

## Private Git remote (not configured)

DocForce's source tree currently has **no git remote**. A Git-URL dependency
requires, from a human with hosting access:

- A private repository URL (host + owner + name)
- Permission to push this source and tags (`v1.0.0`)
- A read-only deploy key or machine user for CI
- A decision that fork pull requests will not receive that credential

Until that exists, consumers should pin the `npm pack` tarball. Do not invent
an organization or GitHub URL.
