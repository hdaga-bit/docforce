import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { TechnologyInfo, Evidence, Provenance } from "../model/types.js";

export interface EnvironmentFindings {
  technologies: TechnologyInfo[];
  variables: EnvironmentVariable[];
}

export interface EnvironmentVariable {
  readonly name: string;
  readonly required: boolean;
  readonly hasDefault: boolean;
  readonly description?: string;
  readonly provenance: Provenance;
}

function obs(sourceFile: string, detail: string): Provenance {
  const evidence: Evidence[] = [{ sourceFile, evidenceType: "env-config", detail }];
  return { kind: "observation", confidence: "high", evidence };
}

export function scanEnvironment(repoRoot: string): EnvironmentFindings {
  const result: EnvironmentFindings = { technologies: [], variables: [] };

  const envFiles = [".env.example", ".env.sample", ".env.template"];
  for (const envFile of envFiles) {
    const filePath = resolve(repoRoot, envFile);
    if (!existsSync(filePath)) continue;

    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    result.technologies.push({
      name: "Environment Configuration",
      category: "configuration",
      purpose: `Environment variables defined in ${envFile}`,
      provenance: obs(envFile, `${envFile} exists`),
    });

    let lastComment = "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#")) {
        lastComment = trimmed.slice(1).trim();
        continue;
      }
      if (trimmed === "") {
        lastComment = "";
        continue;
      }

      const isCommented = line.trimStart().startsWith("#");
      const cleanLine = isCommented ? trimmed.slice(1).trim() : trimmed;
      const eqIdx = cleanLine.indexOf("=");
      if (eqIdx === -1) continue;

      const varName = cleanLine.slice(0, eqIdx).trim();
      const varValue = cleanLine.slice(eqIdx + 1).trim();

      if (!varName || varName.includes(" ")) continue;

      result.variables.push({
        name: varName,
        required: !isCommented && !varValue.includes("your-"),
        hasDefault: varValue !== "" && !varValue.includes("your-") && !varValue.includes("your_"),
        description: lastComment || undefined,
        provenance: obs(envFile, `${varName}=${varValue || "(empty)"}`),
      });

      lastComment = "";
    }
  }

  return result;
}
