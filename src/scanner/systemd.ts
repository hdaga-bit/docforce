import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { InfrastructureInfo, Evidence, Provenance } from "../model/types.js";

export interface SystemdFindings {
  infrastructure: InfrastructureInfo[];
}

function obs(sourceFile: string, detail: string): Provenance {
  const evidence: Evidence[] = [{ sourceFile, evidenceType: "systemd-unit", detail }];
  return { kind: "observation", confidence: "high", evidence };
}

function parseServiceUnit(content: string, relPath: string): InfrastructureInfo[] {
  const results: InfrastructureInfo[] = [];

  const descMatch = content.match(/^Description=(.+)$/m);
  const userMatch = content.match(/^User=(.+)$/m);
  const execMatch = content.match(/^ExecStart=(.+)$/m);
  const wdMatch = content.match(/^WorkingDirectory=(.+)$/m);
  const afterMatch = content.match(/^After=(.+)$/m);
  const requiresMatch = content.match(/^Requires=(.+)$/m);

  const details: string[] = [];
  if (descMatch) details.push(`Description: ${descMatch[1]}`);
  if (userMatch) details.push(`User: ${userMatch[1]}`);
  if (execMatch) details.push(`ExecStart: ${execMatch[1]}`);
  if (wdMatch) details.push(`WorkingDirectory: ${wdMatch[1]}`);

  results.push({
    type: "systemd-service",
    name: relPath.replace(/\.service$/, ""),
    detail: details.join("; "),
    provenance: obs(relPath, details.join("; ")),
  });

  if (afterMatch) {
    const deps = afterMatch[1]!.split(/\s+/);
    for (const dep of deps) {
      if (dep === "network-online.target") continue;
      results.push({
        type: "systemd-dependency",
        name: dep,
        detail: `Required by ${relPath} (After=)`,
        provenance: obs(relPath, `After=${dep}`),
      });
    }
  }

  if (requiresMatch) {
    const deps = requiresMatch[1]!.split(/\s+/);
    for (const dep of deps) {
      results.push({
        type: "systemd-dependency",
        name: dep,
        detail: `Hard requirement for ${relPath}`,
        provenance: obs(relPath, `Requires=${dep}`),
      });
    }
  }

  return results;
}

export function scanSystemd(repoRoot: string): SystemdFindings {
  const result: SystemdFindings = { infrastructure: [] };

  let files: string[];
  try {
    files = readdirSync(repoRoot).filter((f) => f.endsWith(".service"));
  } catch {
    return result;
  }

  for (const file of files) {
    const filePath = resolve(repoRoot, file);
    if (!existsSync(filePath)) continue;
    try {
      const content = readFileSync(filePath, "utf-8");
      result.infrastructure.push(...parseServiceUnit(content, file));
    } catch {
      // skip unreadable
    }
  }

  return result;
}
