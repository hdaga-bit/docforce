import { ConsoleReporter, StepSummaryReporter, type PullRequestReporter } from "../reporter.js";
import { GithubCheckReporter } from "./checkReporter.js";
import { GithubCommentReporter } from "./commentReporter.js";
import { createGithubApi, type GithubApi } from "./http.js";
import { readGithubToken, type EnvLike, type GithubPrContext } from "./context.js";

export const PR_REPORTER_KINDS = ["check", "comment", "none"] as const;
export type PrReporterKind = (typeof PR_REPORTER_KINDS)[number];

export interface ReporterResolution {
  readonly reporter?: PullRequestReporter;
  /** Reporter name recorded in the result even when publishing is skipped. */
  readonly name: string;
  readonly skippedReason?: string;
}

export interface ResolveReporterInput {
  readonly kind: PrReporterKind;
  readonly publish: boolean;
  readonly context: GithubPrContext;
  readonly repository?: string;
  readonly prNumber?: number;
  readonly headSha?: string;
  readonly env?: EnvLike;
  /** Injectable for tests; defaults to a live authenticated client. */
  readonly api?: GithubApi;
}

/**
 * Choose a publishing surface, refusing to publish when doing so would need a
 * privileged token in an untrusted context.
 *
 * Fork policy: on a `pull_request` event from a fork, GitHub deliberately
 * issues a read-only token. DocForce does not attempt to escalate that, and
 * does not accept a write token in that context. It falls back to the job
 * summary, which requires no credentials.
 */
export function resolvePullRequestReporter(input: ResolveReporterInput): ReporterResolution {
  const env = input.env ?? process.env;

  if (!input.publish || input.kind === "none") {
    return { name: "none", skippedReason: "Publishing disabled (--no-publish)" };
  }

  if (input.context.fromFork) {
    const summaryPath = env.GITHUB_STEP_SUMMARY;
    const reason =
      "Pull request originates from a fork. DocForce will not use a repository write token in an untrusted context; publishing to the job summary instead.";
    if (summaryPath) {
      return { reporter: new StepSummaryReporter(summaryPath), name: "step-summary", skippedReason: reason };
    }
    return { reporter: new ConsoleReporter(), name: "console", skippedReason: reason };
  }

  const token = readGithubToken(env);
  if (!token) {
    return { name: input.kind === "comment" ? "github-comment" : "github-check", skippedReason: "No GitHub token available" };
  }

  const repository = input.repository ?? input.context.repository;
  if (!repository) {
    return { name: input.kind === "comment" ? "github-comment" : "github-check", skippedReason: "Repository could not be determined" };
  }

  const api = input.api ?? createGithubApi(token);

  if (input.kind === "comment") {
    const prNumber = input.prNumber ?? input.context.prNumber;
    if (!prNumber) {
      return { name: "github-comment", skippedReason: "Pull request number could not be determined" };
    }
    return { reporter: new GithubCommentReporter({ api, repository, prNumber }), name: "github-comment" };
  }

  const headSha = input.headSha ?? input.context.headSha;
  if (!headSha) {
    return { name: "github-check", skippedReason: "Head SHA could not be determined" };
  }

  return { reporter: new GithubCheckReporter({ api, repository, headSha }), name: "github-check" };
}
