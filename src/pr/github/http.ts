const GITHUB_API = "https://api.github.com";
const API_VERSION = "2022-11-28";

export interface GithubApiRequest {
  readonly method: "GET" | "POST" | "PATCH";
  readonly path: string;
  readonly body?: unknown;
}

export interface GithubApiResponse {
  readonly status: number;
  readonly json: unknown;
}

export interface GithubApi {
  request(input: GithubApiRequest): Promise<GithubApiResponse>;
}

/**
 * Remove credential material from any text that may reach a log or report.
 * Tokens are never printed, even in failure paths.
 */
export function redactToken(message: string, token?: string): string {
  let result = message;
  if (token && token.length >= 8) {
    result = result.split(token).join("[REDACTED]");
  }
  return result
    .replace(/gh[pousr]_[A-Za-z0-9]{10,}/g, "[REDACTED]")
    .replace(/github_pat_[A-Za-z0-9_]{10,}/g, "[REDACTED]")
    .replace(/(Bearer|token)\s+[A-Za-z0-9._-]{10,}/gi, "$1 [REDACTED]");
}

export class GithubReportingError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number, token?: string) {
    super(redactToken(message, token));
    this.name = "GithubReportingError";
    if (status !== undefined) this.status = status;
  }
}

export function createGithubApi(token: string, baseUrl: string = GITHUB_API): GithubApi {
  if (!token) {
    throw new GithubReportingError("No GitHub token available for publishing the DocForce assessment");
  }

  return {
    async request(input: GithubApiRequest): Promise<GithubApiResponse> {
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "DocForce",
      };
      if (input.body !== undefined) headers["Content-Type"] = "application/json";

      try {
        const response = await fetch(`${baseUrl}${input.path}`, {
          method: input.method,
          headers,
          body: input.body === undefined ? undefined : JSON.stringify(input.body),
        });
        const json: unknown = await response.json().catch(() => undefined);
        return { status: response.status, json };
      } catch (error) {
        throw new GithubReportingError(
          error instanceof Error ? error.message : String(error),
          undefined,
          token,
        );
      }
    },
  };
}

const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export interface GithubRepositoryRef {
  readonly owner: string;
  readonly repo: string;
}

/**
 * Parse owner/repo strictly. Repository identifiers come from the CI
 * environment and are interpolated into API paths, so anything outside the
 * allowed character set is rejected rather than escaped.
 */
export function parseRepository(value: string): GithubRepositoryRef {
  const trimmed = value.trim();
  if (!REPOSITORY_PATTERN.test(trimmed) || trimmed.includes("..")) {
    throw new GithubReportingError(`Invalid GitHub repository identifier: "${trimmed}"`);
  }
  const [owner, repo] = trimmed.split("/");
  if (!owner || !repo) {
    throw new GithubReportingError(`Invalid GitHub repository identifier: "${trimmed}"`);
  }
  return { owner, repo };
}

const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

export function assertSha(value: string): string {
  if (!SHA_PATTERN.test(value)) {
    throw new GithubReportingError(`Invalid commit SHA for GitHub reporting: "${value}"`);
  }
  return value;
}
