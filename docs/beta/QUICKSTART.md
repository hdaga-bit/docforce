# Try DocForce

One-page guide for a private beta tester. No DocForce knowledge required.

## 1. Create a temporary branch

In the **consumer repository** you want to evaluate:

```bash
git checkout -b docforce-trial
```

DocForce will not commit, push, or change branches for you.

## 2. Install the supplied package

From this consumer repository, run the script that matches your OS
(or install the tarball yourself):

```bash
# Windows (PowerShell), from the consumer repo:
powershell -File path\to\DocForce-Beta-v1.4.1\install-windows.ps1

# macOS / Linux:
sh path/to/DocForce-Beta-v1.4.1/install-unix.sh
```

Equivalent:

```bash
npm install ./path/to/DocForce-Beta-v1.4.1/mary-docforce-1.4.1.tgz
```

This installs into the **current** repository. It does not install globally.

## 3. Run a trial

```bash
npx docforce try
```

If PDF generation is skipped:

```bash
npx playwright install chromium
npx docforce try
```

## 4. Open the generated PDF

Look under:

`.docforce/trial/<Product>-Technical-Architecture.pdf`

No product source files are modified. `docforce.yml` is not created.

## 5. Fill the feedback form

Edit `.docforce/trial/FEEDBACK.md` and send it back to the person who
gave you this package. Nothing is uploaded automatically.

## Adopt later

```bash
npx docforce init
npx docforce run
```
