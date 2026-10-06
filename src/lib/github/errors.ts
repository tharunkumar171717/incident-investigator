export type GitHubErrorCode =
  | "github_not_configured"
  | "github_auth_failed"
  | "github_access_denied"
  | "github_rate_limited"
  | "github_not_found"
  | "github_unavailable"
  | "github_conflict"
  | "github_validation"
  | "repo_not_allowed"
  | "repo_too_large";

export class GitHubError extends Error {
  constructor(
    public code: GitHubErrorCode,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

interface OctokitLikeError {
  status?: number;
  message?: string;
  response?: { headers?: Record<string, string | undefined>; data?: { message?: string } };
}

/** Maps Octokit/network failures to user-facing errors. */
export function toGitHubError(err: unknown, what: string): GitHubError {
  if (err instanceof GitHubError) return err;
  const e = (err ?? {}) as OctokitLikeError;
  const status = typeof e.status === "number" ? e.status : 0;
  const ghMessage = e.response?.data?.message ?? e.message ?? "unknown error";

  if (status === 401) return new GitHubError("github_auth_failed", "GitHub rejected the server token (401). Check GITHUB_TOKEN.", 401);
  if (status === 403 || status === 429) {
    if (e.response?.headers?.["x-ratelimit-remaining"] === "0" || /rate limit/i.test(ghMessage)) {
      return new GitHubError("github_rate_limited", "GitHub API rate limit reached. Try again in a few minutes.", 429);
    }
    return new GitHubError("github_access_denied", `GitHub denied access while trying to ${what}: ${ghMessage}. The token may lack the required permission.`, 403);
  }
  if (status === 404) return new GitHubError("github_not_found", `Not found on GitHub while trying to ${what}. The repository, branch or path does not exist, or the token cannot see it.`, 404);
  if (status === 409) return new GitHubError("github_conflict", `GitHub reported a conflict while trying to ${what}: ${ghMessage}`, 409);
  if (status === 422) return new GitHubError("github_validation", `GitHub rejected the request to ${what}: ${ghMessage}`, 422);
  if (status >= 500 || status === 0) {
    return new GitHubError("github_unavailable", `GitHub is unavailable (${status || "network error"}) while trying to ${what}. Retry shortly.`, 503);
  }
  return new GitHubError("github_unavailable", `GitHub error ${status} while trying to ${what}: ${ghMessage}`, 502);
}
