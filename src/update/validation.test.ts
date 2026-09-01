import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateStagedArtifacts } from "./validation.js";
import type { StagedArtifact } from "./staging.js";
import { removeTree } from "../path/fs.js";

function staged(path: string, status: StagedArtifact["status"] = "would-update"): StagedArtifact {
  return {
    artifact: "technical-overview.md",
    path,
    content: "# Overview\n",
    newHash: "abc",
    status,
    impact: undefined,
  };
}

describe("staged update root validation", () => {
  let repo: string;

  beforeEach(() => {
    repo = join(tmpdir(), `docforce-update-val-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(join(repo, "docs", "generated"), { recursive: true });
  });

  afterEach(() => {
    removeTree(repo);
  });

  it("accepts a generated-doc path inside the repository", () => {
    const result = validateStagedArtifacts([staged("docs/generated/technical-overview.md")], repo);
    assert.equal(result.valid, true);
  });

  it("accepts native separators for a path that stays inside the repo", () => {
    const result = validateStagedArtifacts([staged(join("docs", "generated", "technical-overview.md"))], repo);
    assert.equal(result.valid, true, result.errors.join("; "));
  });

  it("rejects POSIX and Windows traversal of the repository root", () => {
    for (const path of ["../../etc/passwd", "..\\..\\outside.md", "docs/../../outside.md", "docs\\..\\..\\outside.md"]) {
      const result = validateStagedArtifacts([staged(path, "would-create")], repo);
      assert.equal(result.valid, false, path);
      assert.ok(result.errors.some((e) => e.includes("outside repository root")), path);
    }
  });
});
