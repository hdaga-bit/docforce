import { chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
try {
  chmodSync(resolve(here, "../dist/cli.js"), 0o755);
} catch {
  // Windows and some filesystems ignore chmod; the shebang is unused there.
}
