import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveInstalledCliEntry,
  resolveNodeCommand,
  resolveNpmCliEntry,
  resolveNpmCommand,
  runGit,
  runNpm,
} from "./exec.js";
import { removeTree } from "../path/fs.js";

describe("cross-platform executable resolution", () => {
  it("resolves npm without a machine-specific path", () => {
    const npm = resolveNpmCommand();
    assert.equal(npm, process.platform === "win32" ? "npm.cmd" : "npm");
    assert.ok(!npm.includes("\\Users\\"));
    assert.ok(!npm.includes("/home/"));
  });

  it("uses the current Node process executable", () => {
    assert.equal(resolveNodeCommand(), process.execPath);
  });

  it("resolves an installed package CLI through dist/cli.js", () => {
    const root = join("node_modules", "@mary", "docforce");
    assert.equal(resolveInstalledCliEntry(root), join(root, "dist", "cli.js"));
  });

  it("invokes npm through node and npm-cli.js", () => {
    const cli = resolveNpmCliEntry();
    assert.ok(cli && cli.endsWith(".js"), "npm-cli.js must be resolvable");
    const out = runNpm(["--version"], { cwd: process.cwd() });
    assert.match(out, /^\d+\.\d+/);
  });
});

describe("Git pathspec invocation", () => {
  let repo: string;

  beforeEach(() => {
    repo = join(tmpdir(), `docforce-git-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(join(repo, ".docforce"), { recursive: true });
    runGit(["init"], { cwd: repo });
    runGit(["config", "user.email", "test@docforce.test"], { cwd: repo });
    runGit(["config", "user.name", "DocForce Test"], { cwd: repo });
    writeFileSync(join(repo, "tracked.txt"), "ok\n", { encoding: "utf-8" });
    writeFileSync(join(repo, ".docforce", "report.md"), "generated\n", { encoding: "utf-8" });
    runGit(["add", "tracked.txt"], { cwd: repo });
    runGit(["commit", "-m", "init"], { cwd: repo });
  });

  afterEach(() => {
    removeTree(repo);
  });

  it("excludes .docforce via argument-array pathspec", () => {
    writeFileSync(join(repo, ".docforce", "report.md"), "changed\n", { encoding: "utf-8" });
    const dirty = runGit(["status", "--porcelain", "--", ".", ":!.docforce"], { cwd: repo });
    assert.equal(dirty, "");
  });

  it("still reports a tracked working-tree edit", () => {
    writeFileSync(join(repo, "tracked.txt"), "edited\n", { encoding: "utf-8" });
    const dirty = runGit(["status", "--porcelain", "--", ".", ":!.docforce"], { cwd: repo });
    assert.ok(dirty.includes("tracked.txt"));
  });
});
