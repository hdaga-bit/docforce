import type { PullRequestReporter } from "../reporter.js";
import { DOCFORCE_PR_MARKER, renderPrComment } from "../summary.js";
import type { PullRequestDocumentationAssessment } from "../types.js";
import { GithubReportingError, parseRepository, type GithubApi } from "./http.js";

export interface GithubCommentReporterOptions {
  readonly api: GithubApi;
  readonly repository: string;
  readonly prNumber: number;
}

/**
 * Publishes the assessment as a single managed pull-request comment.
 *
 * The comment is located by a stable marker and updated in place, so repeated
 * runs on the same pull request never accumulate duplicate comments.
 */
export class GithubCommentReporter implements PullRequestReporter {
  readonly name = "github-comment";

  constructor(private readonly options: GithubCommentReporterOptions) {}

  async publishAssessment(assessment: PullRequestDocumentationAssessment): Promise<void> {
    const { owner, repo } = parseRepository(this.options.repository);
    const prNumber = this.options.prNumber;
    if (!Number.isInteger(prNumber) || prNumber <= 0) {
      throw new GithubReportingError(`Invalid pull request number: ${String(prNumber)}`);
    }

    const body = renderPrComment(assessment);
    const existingId = await this.findExistingComment(owner, repo, prNumber);

    const response = existingId
      ? await this.options.api.request({
          method: "PATCH",
          path: `/repos/${owner}/${repo}/issues/comments/${existingId}`,
          body: { body },
        })
      : await this.options.api.request({
          method: "POST",
          path: `/repos/${owner}/${repo}/issues/${prNumber}/comments`,
          body: { body },
        });

    if (response.status < 200 || response.status >= 300) {
      throw new GithubReportingError(
        `GitHub comment ${existingId ? "update" : "creation"} failed (HTTP ${response.status})`,
        response.status,
      );
    }
  }

  private async findExistingComment(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<number | undefined> {
    for (let page = 1; page <= 10; page++) {
      const query = new URLSearchParams({ per_page: "100", page: String(page) });
      const response = await this.options.api.request({
        method: "GET",
        path: `/repos/${owner}/${repo}/issues/${prNumber}/comments?${query.toString()}`,
      });

      if (response.status < 200 || response.status >= 300) return undefined;
      const comments = Array.isArray(response.json) ? response.json : [];
      if (comments.length === 0) return undefined;

      for (const comment of comments) {
        if (!comment || typeof comment !== "object") continue;
        const record = comment as { id?: unknown; body?: unknown };
        if (typeof record.body === "string" && record.body.includes(DOCFORCE_PR_MARKER)) {
          if (typeof record.id === "number") return record.id;
        }
      }

      if (comments.length < 100) return undefined;
    }
    return undefined;
  }
}
