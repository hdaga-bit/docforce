import { assessPullRequest, type PullRequestAssessmentInput } from "./assess.js";
import { writePrAssessmentReports } from "./report.js";
import type { PullRequestReporter } from "./reporter.js";
import { redactToken } from "./github/http.js";
import type { PrReportingOutcome, PullRequestCheckResult } from "./types.js";

export interface PullRequestCheckInput extends PullRequestAssessmentInput {
  readonly reporter?: PullRequestReporter;
  /** Name recorded when no reporter runs (e.g. skipped for a fork). */
  readonly reporterName?: string;
  readonly skippedReason?: string;
  /** Write the detailed local report under .docforce/reports. Default true. */
  readonly writeLocalReport?: boolean;
}

/**
 * Assess a pull request and publish the result to the configured surface.
 *
 * Reporting is strictly downstream of assessment: a reporter failure is
 * surfaced, never allowed to alter or discard the assessment.
 */
export async function runPullRequestCheck(
  input: PullRequestCheckInput,
): Promise<PullRequestCheckResult> {
  const assessment = await assessPullRequest(input);

  const localReport =
    input.writeLocalReport === false ? undefined : writePrAssessmentReports(assessment, input.repoRoot);

  let reporting: PrReportingOutcome = {
    reporter: input.reporterName ?? input.reporter?.name ?? "none",
    attempted: false,
    published: false,
    skippedReason: input.skippedReason,
  };

  if (input.reporter) {
    try {
      await input.reporter.publishAssessment(assessment);
      reporting = { ...reporting, attempted: true, published: true };
    } catch (err) {
      reporting = {
        ...reporting,
        attempted: true,
        published: false,
        error: redactToken((err as Error).message),
      };
    }
  }

  return { assessment, reporting, localReport };
}
