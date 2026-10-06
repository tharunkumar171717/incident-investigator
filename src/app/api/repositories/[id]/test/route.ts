import { NextResponse } from "next/server";
import { getRepoMetadata, readClient } from "@/lib/github/client";
import { GitHubError, toGitHubError } from "@/lib/github/errors";
import { handle, HttpError, requireUser } from "@/lib/http";
import type { RepositoryRow } from "@/lib/db/types";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

/** Verifies the server token can read the repository (and whether it could open PRs). */
export const POST = handle(async (_req: Request, ctx: RouteContext<"/api/repositories/[id]/test">) => {
  const { id } = await ctx.params;
  const { supabase } = await requireUser();
  const { data: repo } = await supabase.from("repositories").select("*").eq("id", id).maybeSingle<RepositoryRow>();
  if (!repo) throw new HttpError(404, "Repository not found.", "not_found");

  const checks: Check[] = [];
  let meta: Awaited<ReturnType<typeof getRepoMetadata>> | null = null;
  try {
    meta = await getRepoMetadata({ owner: repo.owner, name: repo.name });
    checks.push({ name: "Repository metadata", ok: true, detail: `${meta.full_name} (${meta.private ? "private" : "public"}), default branch ${meta.default_branch}` });
  } catch (err) {
    const e = err instanceof GitHubError ? err : toGitHubError(err, "read the repository");
    checks.push({ name: "Repository metadata", ok: false, detail: e.message });
  }
  if (meta) {
    try {
      const { data } = await readClient().repos.getContent({ owner: repo.owner, repo: repo.name, path: "", ref: meta.default_branch });
      checks.push({ name: "Read contents", ok: true, detail: `${Array.isArray(data) ? data.length : 1} top-level entr${Array.isArray(data) && data.length === 1 ? "y" : "ies"}` });
    } catch (err) {
      checks.push({ name: "Read contents", ok: false, detail: toGitHubError(err, "read repository contents").message });
    }
    try {
      const { data } = await readClient().repos.listCommits({ owner: repo.owner, repo: repo.name, per_page: 1 });
      checks.push({ name: "Read commit history", ok: true, detail: data[0] ? `latest ${data[0].sha.slice(0, 7)}: ${data[0].commit.message.split("\n")[0].slice(0, 80)}` : "no commits" });
    } catch (err) {
      checks.push({ name: "Read commit history", ok: false, detail: toGitHubError(err, "read commits").message });
    }
    checks.push({
      name: "Open pull requests",
      ok: Boolean(meta.permissions?.push),
      detail: meta.permissions?.push ? "Token can push branches (PR creation available)." : "Read-only access: investigations work, PR creation will fail.",
    });
  }

  const readable = checks.filter((c) => c.name !== "Open pull requests").every((c) => c.ok);
  const { data: updated } = await supabase
    .from("repositories")
    .update({
      last_verified_at: new Date().toISOString(),
      last_error: readable ? null : checks.find((c) => !c.ok)?.detail ?? "Access check failed",
      ...(meta
        ? {
            default_branch: meta.default_branch,
            description: meta.description,
            language: meta.language,
            is_private: meta.private,
            can_push: Boolean(meta.permissions?.push),
            metadata: { ...repo.metadata, stars: meta.stargazers_count, open_issues: meta.open_issues_count, size_kb: meta.size, pushed_at: meta.pushed_at, archived: meta.archived },
          }
        : {}),
    })
    .eq("id", id)
    .select("*")
    .single();
  return NextResponse.json({ ok: readable, checks, repository: updated });
});
