import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { atomicWriteFile, restoreFile } from "./write.js";
import { removeTree } from "../path/fs.js";

describe("atomic file replacement", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `docforce-write-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    removeTree(dir);
  });

  it("replaces an existing file and can restore the original bytes", () => {
    const path = join(dir, "docs", "behavior.md");
    mkdirSync(join(dir, "docs"), { recursive: true });
    const original = "# Behavior\n\nHuman text.\n";
    writeFileSync(path, original, { encoding: "utf-8" });
    atomicWriteFile(path, "# Behavior\n\nUpdated.\n");
    assert.equal(readFileSync(path, "utf-8"), "# Behavior\n\nUpdated.\n");
    restoreFile(path, original);
    assert.equal(readFileSync(path, "utf-8"), original);
  });
});
