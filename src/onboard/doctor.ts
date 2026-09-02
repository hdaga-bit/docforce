import { accessSync, constants, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig, resolveConfigPath } from "../config/index.js";
import { CHROMIUM_INSTALL_HINT, diagnosePublicationRenderer } from "../publication/browser.js";
import { resolveReasoningProvider } from "../review/resolveProvider.js";
import { isPathInsideRoot } from "../path/canonical.js";

export const DOCTOR_STATUSES = ["READY", "WARNING", "ERROR"] as const;
export type DoctorStatus = (typeof DOCTOR_STATUSES)[number];

export interface DoctorCheck {
  readonly id: string;
  readonly status: DoctorStatus;
  readonly title: string;
  readonly detail: string;
}

export interface DoctorResult {
  readonly status: DoctorStatus;
  readonly checks: readonly DoctorCheck[];
}

export interface DoctorOptions {
  readonly repoRoot: string;
  readonly requireConfig?: boolean;
  readonly diagnoseRenderer?: () => Promise<{ ok: boolean; error?: string }>;
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorResult> {
  const repoRoot = resolve(options.repoRoot);
  const requireConfig = options.requireConfig !== false;
  const checks: DoctorCheck[] = [];

  checks.push(nodeCheck());
  checks.push(gitCheck(repoRoot));
  checks.push(writeAccessCheck(repoRoot));

  const configPath = resolveConfigPath(repoRoot);
  if (!existsSync(configPath)) {
    checks.push({
      id: "config",
      status: requireConfig ? "ERROR" : "WARNING",
      title: "docforce.yml",
      detail: requireConfig
        ? "Missing. Run `docforce init` to create a starter config."
        : "Missing. Trial mode will use inferred configuration.",
    });
  } else {
    try {
      const config = loadConfig(configPath);
      checks.push({
        id: "config",
        status: "READY",
        title: "docforce.yml",
        detail: `Valid. Product ${config.product.name}.`,
      });
      const missingRoots = config.scanning.include.filter((pattern) => {
        const root = pattern.replace(/\/\*\*$/, "").replace(/\\/g, "/");
        if (root.includes("*")) return false;
        return !existsSync(join(repoRoot, root));
      });
      checks.push({
        id: "source-roots",
        status: missingRoots.length > 0 ? "WARNING" : "READY",
        title: "Source roots",
        detail: missingRoots.length > 0
          ? `Configured includes not found: ${missingRoots.join(", ")}`
          : `Include ${config.scanning.include.join(", ")}`,
      });
      const outputs = [
        config.output.systemModel,
        config.output.docs.technicalOverview,
        config.publication?.outputDir ?? "docs/published",
      ];
      const escaped = outputs.filter((rel) => !isPathInsideRoot(repoRoot, resolve(repoRoot, rel)));
      checks.push({
        id: "output-paths",
        status: escaped.length > 0 ? "ERROR" : "READY",
        title: "Output paths",
        detail: escaped.length > 0
          ? `Output path outside repository: ${escaped.join(", ")}`
          : "Output paths are inside the repository.",
      });
    } catch (err) {
      checks.push({
        id: "config",
        status: "ERROR",
        title: "docforce.yml",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const diagnose = options.diagnoseRenderer ?? diagnosePublicationRenderer;
  const renderer = await diagnose();
  checks.push({
    id: "chromium",
    status: renderer.ok ? "READY" : "WARNING",
    title: "Publication renderer",
    detail: renderer.ok
      ? "Playwright Chromium is available."
      : `Unavailable. PDF/diagram publication is skipped. ${CHROMIUM_INSTALL_HINT}`,
  });

  const provider = resolveReasoningProvider();
  checks.push({
    id: "ai",
    status: "READY",
    title: "AI provider",
    detail: provider
      ? "Optional AI provider is available. DocForce does not invoke it automatically."
      : "No AI provider configured. Deterministic analysis does not require one.",
  });

  const status = worstStatus(checks.map((c) => c.status));
  return { status, checks };
}

export function formatDoctorReport(result: DoctorResult): string {
  const lines = ["DocForce doctor", ""];
  for (const check of result.checks) {
    lines.push(`  ${padStatus(check.status)}  ${check.title}`);
    lines.push(`           ${check.detail}`);
  }
  lines.push("");
  lines.push(`Status: ${result.status}`);
  return lines.join("\n");
}

function nodeCheck(): DoctorCheck {
  const version = process.versions.node;
  const major = Number(version.split(".")[0]);
  if (!Number.isFinite(major) || major < 20) {
    return {
      id: "node",
      status: "ERROR",
      title: "Node.js runtime",
      detail: `Node.js ${version} is below the required >=20.`,
    };
  }
  return {
    id: "node",
    status: "READY",
    title: "Node.js runtime",
    detail: `Node.js ${version}`,
  };
}

function gitCheck(repoRoot: string): DoctorCheck {
  if (existsSync(join(repoRoot, ".git"))) {
    return {
      id: "git",
      status: "READY",
      title: "Git repository",
      detail: "Git metadata is present. DocForce will not commit or change branches.",
    };
  }
  return {
    id: "git",
    status: "WARNING",
    title: "Git repository",
    detail: "Not a Git repository. Analysis still works; provenance may be limited.",
  };
}

function writeAccessCheck(repoRoot: string): DoctorCheck {
  try {
    accessSync(repoRoot, constants.W_OK);
    const probe = join(repoRoot, ".docforce", ".doctor-write-probe");
    mkdirSync(join(repoRoot, ".docforce"), { recursive: true });
    writeFileSync(probe, "ok");
    rmSync(probe, { force: true });
    return {
      id: "write",
      status: "READY",
      title: "Repository write access",
      detail: "Writable for .docforce state.",
    };
  } catch (err) {
    return {
      id: "write",
      status: "ERROR",
      title: "Repository write access",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

function worstStatus(statuses: readonly DoctorStatus[]): DoctorStatus {
  if (statuses.includes("ERROR")) return "ERROR";
  if (statuses.includes("WARNING")) return "WARNING";
  return "READY";
}

function padStatus(status: DoctorStatus): string {
  return status.padEnd(7, " ");
}
