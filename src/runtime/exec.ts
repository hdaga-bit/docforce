import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export function resolveNpmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

/**
 * JS entry for npm. `execFileSync("npm.cmd")` is EINVAL on Windows
 * without a shell. Invoking `node <npm-cli.js>` is portable and does
 * not hard-code a user home path.
 */
export function resolveNpmCliEntry(): string | undefined {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  for (const candidate of candidates) {
    if (candidate && candidate.endsWith(".js") && existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export function resolveNodeCommand(): string {
  return process.execPath;
}

/**
 * JS entry of an installed `@mary/docforce` package.
 * Prefer `node <package>/dist/cli.js` over `node_modules/.bin/docforce`,
 * which is `docforce.cmd` on Windows and is not a POSIX executable.
 */
export function resolveInstalledCliEntry(installedPackageRoot: string): string {
  return join(installedPackageRoot, "dist", "cli.js");
}

export interface ExecFileOptions {
  readonly cwd: string;
  readonly timeout?: number;
  readonly maxBuffer?: number;
  readonly env?: NodeJS.ProcessEnv;
}

export function runNodeScript(
  scriptPath: string,
  args: readonly string[],
  options: ExecFileOptions,
): string {
  return execFileSync(resolveNodeCommand(), [scriptPath, ...args], {
    cwd: options.cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: options.timeout ?? 120_000,
    maxBuffer: options.maxBuffer,
    env: options.env,
  });
}

export function runNpm(args: readonly string[], options: ExecFileOptions): string {
  const cli = resolveNpmCliEntry();
  if (!cli) {
    throw new Error("Unable to resolve npm-cli.js; Node must ship a bundled npm");
  }
  return execFileSync(resolveNodeCommand(), [cli, ...args], {
    cwd: options.cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: options.timeout ?? 120_000,
    maxBuffer: options.maxBuffer,
    env: options.env,
  });
}

export function runGit(args: readonly string[], options: ExecFileOptions): string {
  return execFileSync("git", [...args], {
    cwd: options.cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: options.timeout ?? 30_000,
    maxBuffer: options.maxBuffer,
    env: options.env,
  }).trim();
}

export function tryGit(args: readonly string[], options: ExecFileOptions): string | null {
  try {
    return runGit(args, options) || null;
  } catch {
    return null;
  }
}
