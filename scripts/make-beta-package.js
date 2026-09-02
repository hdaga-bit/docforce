import { cpSync, existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")).version;
const dest = join(root, `DocForce-Beta-v${version}`);
mkdirSync(dest, { recursive: true });

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error("Run via npm run beta-package so npm_execpath is set");
}
const packed = spawnSync(process.execPath, [npmCli, "pack"], { cwd: root, encoding: "utf-8" });
if (packed.status !== 0) {
  process.stderr.write(packed.stderr ?? "");
  process.exit(packed.status ?? 1);
}
const tarballName = `mary-docforce-${version}.tgz`;
const from = join(root, tarballName);
if (!existsSync(from)) {
  throw new Error(`Expected ${tarballName} after npm pack`);
}
renameSync(from, join(dest, tarballName));
cpSync(join(root, "docs", "beta", "QUICKSTART.md"), join(dest, "QUICKSTART.md"));
cpSync(join(root, "docs", "beta", "install-windows.ps1"), join(dest, "install-windows.ps1"));
cpSync(join(root, "docs", "beta", "install-unix.sh"), join(dest, "install-unix.sh"));
console.log(`Wrote ${dest}`);
