import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import type {
  WorkflowInfo,
  TechnologyInfo,
  Evidence,
  Provenance,
} from "../model/types.js";

export interface GithubFindings {
  workflows: WorkflowInfo[];
  technologies: TechnologyInfo[];
}

function obs(sourceFile: string, detail: string): Provenance {
  const evidence: Evidence[] = [{ sourceFile, evidenceType: "github-actions", detail }];
  return { kind: "observation", confidence: "high", evidence };
}

function parseWorkflowYaml(content: string, relPath: string): WorkflowInfo | null {
  const nameMatch = content.match(/^name:\s*(.+)$/m);
  const name = nameMatch ? nameMatch[1]!.trim().replace(/^["']|["']$/g, "") : relPath;

  const triggers: string[] = [];
  const onMatch = content.match(/^on:\s*$/m);
  const onInlineMatch = content.match(/^on:\s*\[([^\]]+)\]/m);
  const onSingleMatch = content.match(/^on:\s+(\w+)/m);

  if (onInlineMatch) {
    triggers.push(...onInlineMatch[1]!.split(",").map((t) => t.trim()));
  } else if (onMatch) {
    const lines = content.split("\n");
    const onIdx = lines.findIndex((l) => /^on:\s*$/.test(l));
    if (onIdx >= 0) {
      for (let i = onIdx + 1; i < lines.length; i++) {
        const line = lines[i]!;
        if (line.trim() === "" || (!line.startsWith(" ") && !line.startsWith("\t"))) break;
        const eventMatch = line.match(/^\s{2}(\w[\w-]*):/);
        if (eventMatch) triggers.push(eventMatch[1]!);
      }
    }
  } else if (onSingleMatch) {
    triggers.push(onSingleMatch[1]!);
  }

  const steps: string[] = [];
  const runMatches = content.match(/^\s+-\s+run:\s+(.+)$/gm);
  if (runMatches) {
    for (const match of runMatches) {
      const cmd = match.replace(/^\s+-\s+run:\s+/, "").trim();
      steps.push(cmd);
    }
  }
  const usesMatches = content.match(/^\s+-\s+uses:\s+(.+)$/gm);
  if (usesMatches) {
    for (const match of usesMatches) {
      const action = match.replace(/^\s+-\s+uses:\s+/, "").trim();
      steps.push(`uses: ${action}`);
    }
  }

  return {
    name,
    trigger: triggers.join(", ") || undefined,
    steps: steps.length > 0 ? steps : undefined,
    provenance: obs(relPath, `Workflow: ${name}`),
  };
}

export function scanGithubActions(repoRoot: string): GithubFindings {
  const result: GithubFindings = { workflows: [], technologies: [] };
  const workflowDir = resolve(repoRoot, ".github", "workflows");

  if (!existsSync(workflowDir)) return result;

  let files: string[];
  try {
    files = readdirSync(workflowDir).filter(
      (f) => f.endsWith(".yml") || f.endsWith(".yaml"),
    );
  } catch {
    return result;
  }

  if (files.length > 0) {
    result.technologies.push({
      name: "GitHub Actions",
      category: "ci-cd",
      purpose: `CI/CD pipelines (${files.length} workflow${files.length > 1 ? "s" : ""})`,
      provenance: obs(".github/workflows/", `${files.length} workflow files found`),
    });
  }

  for (const file of files) {
    const filePath = join(workflowDir, file);
    const relPath = `.github/workflows/${file}`;
    try {
      const content = readFileSync(filePath, "utf-8");
      const workflow = parseWorkflowYaml(content, relPath);
      if (workflow) result.workflows.push(workflow);
    } catch {
      // skip unreadable files
    }
  }

  return result;
}
