import type { PullRequestReporter } from "../reporter.js";
import { renderPrSummary, renderPrSummaryTitle } from "../summary.js";
import type { PullRequestDocumentationAssessment, PullRequestDocumentationStatus } from "../types.js";
import { assertSha, GithubReportingError, parseRepository, type GithubApi } from "./http.js";

export const DOCFORCE_CHECK_NAME = "DocForce Documentation";

/** GitHub limits check-run output text; stay well inside it. */
const MAX_SUMMARY_CHARS = 60_000;

export type CheckConclusion = "success" | "neutral" | "failure";

/**
 * Map documentation status to a check conclusion.
 *
 * Whether a conclusion blocks a merge is a branch-protection decision owned by
 * the repository, not by DocForce. REVIEW is deliberately neutral: an
 * outstanding behavioural question is not an architecture failure.
 */
export function conclusionForStatus(status: PullRequestDocumentationStatus): CheckConclusion {
  switch (status) {
    case "PASS":
      return "success";
    case "REVIEW":
      return "neutral";
    case "ACTION_REQUIRED":
      return "failure";
    case "ERROR":
      return "neutral";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

export interface GithubCheckReporterOptions {
  readonly api: GithubApi;
  readonly repository: string;
  readonly headSha: string;
  readonly checkName?: string;
}

/**
 * Publishes the assessment as a GitHub Check Run against the head SHA.
 *
 * Follows GitHub semantics for repeated runs: an existing DocForce check run
 * for the same head SHA is updated rather than duplicated.
 */
export class GithubCheckReporter implements PullRequestReporter {
  readonly name = "github-check";
  private readonly checkName: string;

  constructor(private readonly options: GithubCheckReporterOptions) {
    this.checkName = options.checkName ?? DOCFORCE_CHECK_NAME;
  }

  async publishAssessment(assessment: PullRequestDocumentationAssessment): Promise<void> {
    const { owner, repo } = parseRepository(this.options.repository);
    const headSha = assertSha(this.options.headSha);

    const summary = renderPrSummary(assessment).slice(0, MAX_SUMMARY_CHARS);
    const body = {
      name: this.checkName,
      head_sha: headSha,
      status: "completed" as const,
      conclusion: conclusionForStatus(assessment.status),
      completed_at: assessment.generatedAt,
      output: {
        title: renderPrSummaryTitle(assessment),
        summary,
      },
    };

    const existingId = await this.findExistingCheckRun(owner, repo, headSha);

    const response = existingId
      ? await this.options.api.request({
          method: "PATCH",
          path: `/repos/${owner}/${repo}/check-runs/${existingId}`,
          body,
        })
      : await this.options.api.request({
          method: "POST",
          path: `/repos/${owner}/${repo}/check-runs`,
          body,
        });

    if (response.status < 200 || response.status >= 300) {
      throw new GithubReportingError(
        `GitHub check-run ${existingId ? "update" : "creation"} failed (HTTP ${response.status})`,
        response.status,
      );
    }
  }

  private async findExistingCheckRun(
    owner: string,
    repo: string,
    headSha: string,
  ): Promise<number | undefined> {
    const query = new URLSearchParams({ check_name: this.checkName, per_page: "50" });
    const response = await this.options.api.request({
      method: "GET",
      path: `/repos/${owner}/${repo}/commits/${headSha}/check-runs?${query.toString()}`,
    });

    if (response.status < 200 || response.status >= 300) return undefined;

    const payload = response.json as { check_runs?: unknown } | undefined;
    const runs = Array.isArray(payload?.check_runs) ? payload.check_runs : [];
    for (const run of runs) {
      if (!run || typeof run !== "object") continue;
      const record = run as { id?: unknown; name?: unknown };
      if (record.name === this.checkName && typeof record.id === "number") {
        return record.id;
      }
    }
    return undefined;
  }
}
