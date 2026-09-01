#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function gitRevision() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

const identity = {
  name: "@mary/docforce",
  version: "0.9.1",
  gitRevision: gitRevision(),
  packedAt: new Date().toISOString(),
};

writeFileSync(resolve(root, "identity.json"), `${JSON.stringify(identity, null, 2)}\n`, "utf-8");
console.error(`stamped identity.json revision=${identity.gitRevision ?? "none"}`);
