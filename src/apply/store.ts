import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { StoredProposalSchema, type StoredProposal } from "./types.js";

export function proposalsDir(repoRoot: string): string {
  return join(repoRoot, ".docforce", "proposals");
}

export function proposalPath(repoRoot: string, proposalId: string): string {
  return join(proposalsDir(repoRoot), "by-id", `${proposalId}.json`);
}

export function persistStoredProposal(proposal: StoredProposal, repoRoot: string): string {
  const dir = join(proposalsDir(repoRoot), "by-id");
  mkdirSync(dir, { recursive: true });
  const path = proposalPath(repoRoot, proposal.proposalId);
  writeFileSync(path, JSON.stringify(proposal, null, 2), "utf-8");
  return path;
}

export function loadStoredProposal(
  repoRoot: string,
  proposalId: string,
): { ok: true; proposal: StoredProposal } | { ok: false; error: string; raw?: string } {
  const byId = proposalPath(repoRoot, proposalId);
  let raw: string | undefined;

  if (existsSync(byId)) {
    raw = readFileSync(byId, "utf-8");
  } else {
    const latest = join(proposalsDir(repoRoot), "latest.json");
    if (!existsSync(latest)) {
      return { ok: false, error: `Proposal "${proposalId}" not found` };
    }
    try {
      const report = JSON.parse(readFileSync(latest, "utf-8")) as { proposals?: unknown[] };
      const match = (report.proposals ?? []).find((p) => {
        if (!p || typeof p !== "object") return false;
        const rec = p as Record<string, unknown>;
        return rec.proposalId === proposalId || rec.id === proposalId;
      });
      if (!match) {
        return { ok: false, error: `Proposal "${proposalId}" not found` };
      }
      raw = JSON.stringify(match);
    } catch {
      return { ok: false, error: `Proposal "${proposalId}" not found (malformed latest.json)` };
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Malformed proposal JSON", raw };
  }

  const schema = StoredProposalSchema.safeParse(normalizeLoaded(parsed));
  if (!schema.success) {
    return {
      ok: false,
      error: `Proposal schema invalid: ${schema.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      raw,
    };
  }
  return { ok: true, proposal: schema.data };
}

function normalizeLoaded(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== "object") return parsed;
  const rec = parsed as Record<string, unknown>;
  if (!rec.proposalId && typeof rec.id === "string") {
    return { ...rec, proposalId: rec.id };
  }
  return parsed;
}
