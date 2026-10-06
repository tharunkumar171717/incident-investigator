import "server-only";
import { Octokit } from "@octokit/rest";
import { allowedOwners, env } from "@/lib/env";
import { GitHubError, toGitHubError } from "./errors";

export interface RepoRef {
  owner: string;
  name: string;
}

/**
 * Read client. Use a fine-grained token with read-only "Contents" and
 * "Metadata" permissions on the repositories you investigate.
 */
export function readClient(): Octokit {
  const token = env().GITHUB_TOKEN;
  if (!token) throw new GitHubError("github_not_configured", "GITHUB_TOKEN is not set on the server.", 500);
  return new Octokit({ auth: token, userAgent: "incident-investigator", request: { timeout: 30_000 } });
}

/**
 * Write client, used only after explicit user confirmation (or the per-incident
 * auto-fix opt-in) to create a branch, commit the fix and open a PR. Prefer a
 * separate GITHUB_WRITE_TOKEN with "Contents: write" + "Pull requests: write".
 */
export function writeClient(): Octokit {
  const token = env().GITHUB_WRITE_TOKEN || env().GITHUB_TOKEN;
  if (!token) throw new GitHubError("github_not_configured", "GITHUB_WRITE_TOKEN (or GITHUB_TOKEN) is not set on the server.", 500);
  return new Octokit({ auth: token, userAgent: "incident-investigator", request: { timeout: 30_000 } });
}

export function assertOwnerAllowed(owner: string) {
  const allowed = allowedOwners();
  if (allowed && !allowed.includes(owner.toLowerCase())) {
    throw new GitHubError("repo_not_allowed", `Repositories owned by "${owner}" are not allowed on this server (GITHUB_ALLOWED_OWNERS).`, 403);
  }
}

const REPO_RE = /^(?:https?:\/\/github\.com\/|git@github\.com:)?([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/;

export function parseRepoInput(input: string): RepoRef | null {
  const m = input.trim().match(REPO_RE);
  return m ? { owner: m[1], name: m[2] } : null;
}

export async function getRepoMetadata(ref: RepoRef) {
  assertOwnerAllowed(ref.owner);
  try {
    const { data } = await readClient().repos.get({ owner: ref.owner, repo: ref.name });
    return data;
  } catch (err) {
    throw toGitHubError(err, `read ${ref.owner}/${ref.name}`);
  }
}

export async function resolveRef(ref: RepoRef, branchOrSha: string): Promise<string> {
  try {
    const { data } = await readClient().repos.getCommit({ owner: ref.owner, repo: ref.name, ref: branchOrSha });
    return data.sha;
  } catch (err) {
    throw toGitHubError(err, `resolve "${branchOrSha}" in ${ref.owner}/${ref.name}`);
  }
}

export async function listBranches(ref: RepoRef): Promise<string[]> {
  try {
    const branches = await readClient().paginate(readClient().repos.listBranches, {
      owner: ref.owner,
      repo: ref.name,
      per_page: 100,
    });
    return branches.map((b) => b.name).slice(0, 500);
  } catch (err) {
    throw toGitHubError(err, `list branches of ${ref.owner}/${ref.name}`);
  }
}
