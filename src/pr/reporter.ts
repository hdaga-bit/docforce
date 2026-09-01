import { appendFileSync } from "node:fs";
import { renderPrSummary } from "./summary.js";
import type { PullRequestDocumentationAssessment } from "./types.js";

/**
 * Publishing boundary for a pull-request assessment.
 *
 * The assessment engine never depends on a reporter, so new surfaces
 * (GitHub Checks, PR comments, Slack, CLI) can be added without touching
 * assessment logic.
 */
export interface PullRequestReporter {
  readonly name: string;
  publishAssessment(assessment: PullRequestDocumentationAssessment): Promise<void>;
}

/** Prints the concise summary to stdout. Used for --no-publish previews. */
export class ConsoleReporter implements PullRequestReporter {
  readonly name = "console";

  constructor(private readonly write: (line: string) => void = (line) => console.log(line)) {}

  async publishAssessment(assessment: PullRequestDocumentationAssessment): Promise<void> {
    this.write(renderPrSummary(assessment));
  }
}

/**
 * Appends to the GitHub Actions job summary. Safe on forked pull requests
 * because it needs no token and performs no repository write.
 */
export class StepSummaryReporter implements PullRequestReporter {
  readonly name = "step-summary";

  constructor(private readonly summaryPath: string) {}

  async publishAssessment(assessment: PullRequestDocumentationAssessment): Promise<void> {
    appendFileSync(this.summaryPath, `${renderPrSummary(assessment)}\n`, "utf-8");
  }
}

/** Test double that records what would have been published. */
export class RecordingReporter implements PullRequestReporter {
  readonly name = "recording";
  readonly published: PullRequestDocumentationAssessment[] = [];

  async publishAssessment(assessment: PullRequestDocumentationAssessment): Promise<void> {
    this.published.push(assessment);
  }
}

/** Test double that always fails to publish. */
export class FailingReporter implements PullRequestReporter {
  readonly name = "failing";

  constructor(private readonly message = "Simulated reporter failure") {}

  async publishAssessment(_assessment: PullRequestDocumentationAssessment): Promise<void> {
    throw new Error(this.message);
  }
}
