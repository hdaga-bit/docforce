import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  isPathInsideRoot,
  isPathWithinAllowedRoots,
  toFilesystemPath,
  toModelPath,
  toRepositoryRelativePath,
} from "./canonical.js";
import { removeTree } from "./fs.js";

describe("repository-relative path canonicalization", () => {
  let repo: string;

  beforeEach(() => {
    repo = join(tmpdir(), `docforce-path-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(join(repo, "docs"), { recursive: true });
  });

  afterEach(() => {
    removeTree(repo);
  });

  it("accepts a valid docs path under the allowed root", () => {
    assert.equal(isPathWithinAllowedRoots(repo, "docs/behavior.md", ["docs/"]), true);
  });

  it("rejects POSIX traversal", () => {
    assert.equal(isPathWithinAllowedRoots(repo, "../outside.md", ["docs/"]), false);
    assert.equal(isPathWithinAllowedRoots(repo, "docs/../outside.md", ["docs/"]), false);
  });

  it("rejects Windows-style ..\\ traversal", () => {
    assert.equal(isPathWithinAllowedRoots(repo, "docs\\..\\outside.md", ["docs/"]), false);
    assert.equal(isPathWithinAllowedRoots(repo, "..\\outside.md", ["docs/"]), false);
  });

  it("rejects mixed-separator traversal", () => {
    assert.equal(isPathWithinAllowedRoots(repo, "docs/foo\\..\\..\\outside.md", ["docs/"]), false);
    assert.equal(isPathWithinAllowedRoots(repo, "docs\\../outside.md", ["docs/"]), false);
  });

  it("rejects sibling prefix attacks", () => {
    assert.equal(isPathWithinAllowedRoots(repo, "docs-evil/file.md", ["docs/"]), false);
    assert.equal(isPathWithinAllowedRoots(repo, "docs-evil\\file.md", ["docs/"]), false);
  });

  it("rejects a drive-qualified absolute path outside the repository", () => {
    const outside = process.platform === "win32"
      ? `${resolve(repo).slice(0, 2)}\\docforce-outside-abs.md`
      : "/tmp/docforce-outside-abs.md";
    assert.equal(isPathWithinAllowedRoots(repo, outside, ["docs/"]), false);
    assert.equal(isPathInsideRoot(repo, outside), false);
  });

  it("canonicalizes repository-relative paths to POSIX model separators", () => {
    const rel = toRepositoryRelativePath(repo, join(repo, "docs", "behavior.md"));
    assert.equal(rel, "docs/behavior.md");
    assert.equal(toModelPath("docs\\generated\\overview.md"), "docs/generated/overview.md");
  });

  it("converts model paths to native filesystem paths for I/O", () => {
    const fsPath = toFilesystemPath(repo, "docs/behavior.md");
    assert.equal(fsPath, resolve(repo, "docs", "behavior.md"));
    assert.equal(toModelPath(fsPath).includes("\\"), false);
    if (process.platform === "win32") {
      assert.ok(fsPath.includes("\\"));
    }
  });

  it("handles case according to platform semantics", () => {
    const mixed = isPathWithinAllowedRoots(repo, "Docs/behavior.md", ["docs/"]);
    if (process.platform === "win32") {
      assert.equal(mixed, true);
    } else {
      assert.equal(mixed, false);
    }
  });

  it("does not treat Windows normalize() backslashes as an escape", () => {
    assert.equal(isPathInsideRoot(repo, resolve(repo, "docs", "generated", "overview.md")), true);
    assert.equal(toRepositoryRelativePath(repo, resolve(repo, "docs", "generated", "overview.md")), "docs/generated/overview.md");
  });
});
