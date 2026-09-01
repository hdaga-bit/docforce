import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canonicalizeNewlines, GENERATED_LINE_ENDING, toGeneratedText } from "./lineEnding.js";
import { writeGeneratedFile, removeTree } from "./fs.js";
import { hashContent, isProposalStale } from "../draft/sections.js";

describe("generated-artifact line-ending policy", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `docforce-eol-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    removeTree(dir);
  });

  it("defines LF as the generated line ending on every platform", () => {
    assert.equal(GENERATED_LINE_ENDING, "\n");
    assert.equal(toGeneratedText("a\r\nb\rc\n"), "a\nb\nc\n");
  });

  it("writes generated textual artifacts with LF only", () => {
    const path = join(dir, "technical-overview.md");
    writeGeneratedFile(path, "# Title\r\n\r\nBody\r\n");
    const raw = readFileSync(path);
    assert.equal(raw.includes(0x0d), false);
    assert.equal(raw.toString("utf-8"), "# Title\n\nBody\n");
  });

  it("does not rewrite a consumer source file that the caller did not generate", () => {
    const consumer = join(dir, "src-app.ts");
    const crlf = "export const x = 1;\r\n";
    writeFileSync(consumer, crlf, { encoding: "utf-8" });
    assert.equal(readFileSync(consumer, "utf-8"), crlf);
  });

  it("hashes managed sections independently of CRLF vs LF", () => {
    assert.equal(hashContent("Retry count is 10.\r\n"), hashContent("Retry count is 10.\n"));
    assert.equal(canonicalizeNewlines("a\r\nb"), "a\nb");
  });

  it("does not stale a proposal for line-ending-only differences", () => {
    const old = "\nRetry count is 3.\n";
    assert.equal(isProposalStale(hashContent(old), "\r\nRetry count is 3.\r\n"), false);
  });

  it("still stales a proposal when section text changes", () => {
    const old = "\nRetry count is 3.\n";
    assert.equal(isProposalStale(hashContent(old), "\nRetry count is 10.\n"), true);
    assert.equal(isProposalStale(hashContent(old), "\r\nRetry count is 10.\r\n"), true);
  });
});
