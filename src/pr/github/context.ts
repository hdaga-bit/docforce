import { existsSync, readFileSync } from "node:fs";

export interface GithubPrContext {
  readonly repository?: string;
  readonly prNumber?: number;
  readonly baseRefName?: string;
  readonly baseSha?: string;
  readonly headRefName?: string;
  readonly headSha?: string;
  /** True when the head repository is not the base repository. */
  readonly fromFork: boolean;
  readonly eventName?: string;
  readonly runningInActions: boolean;
  /** Presence only — the token value never leaves the adapter. */
  readonly tokenAvailable: boolean;
}

export interface EnvLike {
  readonly [key: string]: string | undefined;
}

/**
 * Read the GitHub token from the environment.
 *
 * Kept out of DocForce core: only the GitHub adapter ever sees it, and the
 * value is never placed in an assessment, report, or log line.
 */
export function readGithubToken(env: EnvLike = process.env): string | undefined {
  const token = env.DOCFORCE_GITHUB_TOKEN?.trim() || env.GITHUB_TOKEN?.trim();
  return token && token.length > 0 ? token : undefined;
}

interface PullRequestEventPayload {
  readonly number?: number;
  readonly pull_request?: {
    readonly number?: number;
    readonly base?: { readonly sha?: string; readonly ref?: string; readonly repo?: { readonly full_name?: string } };
    readonly head?: {
      readonly sha?: string;
      readonly ref?: string;
      readonly repo?: { readonly full_name?: string; readonly fork?: boolean };
    };
  };
}

function readEventPayload(path: string | undefined): PullRequestEventPayload | undefined {
  if (!path || !existsSync(path)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    return parsed && typeof parsed === "object" ? (parsed as PullRequestEventPayload) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve pull-request identity from GitHub Actions environment variables and
 * the event payload. Everything is optional: a missing value degrades to a
 * local preview rather than an error.
 */
export function resolveGithubPrContext(env: EnvLike = process.env): GithubPrContext {
  const payload = readEventPayload(env.GITHUB_EVENT_PATH);
  const pull = payload?.pull_request;

  const baseRepo = pull?.base?.repo?.full_name;
  const headRepo = pull?.head?.repo?.full_name;
  const fromFork =
    pull?.head?.repo?.fork === true ||
    (Boolean(baseRepo) && Boolean(headRepo) && baseRepo !== headRepo);

  return {
    repository: env.GITHUB_REPOSITORY?.trim() || baseRepo,
    prNumber: pull?.number ?? payload?.number,
    baseRefName: pull?.base?.ref ?? env.GITHUB_BASE_REF?.trim() ?? undefined,
    baseSha: pull?.base?.sha,
    headRefName: pull?.head?.ref ?? env.GITHUB_HEAD_REF?.trim() ?? undefined,
    headSha: pull?.head?.sha ?? env.GITHUB_SHA?.trim(),
    fromFork,
    eventName: env.GITHUB_EVENT_NAME?.trim(),
    runningInActions: env.GITHUB_ACTIONS === "true",
    tokenAvailable: readGithubToken(env) !== undefined,
  };
}
