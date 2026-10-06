import "server-only";
import { z } from "zod";
import { readClient, writeClient } from "@/lib/github/client";
import { toGitHubError } from "@/lib/github/errors";
import { defineTool, ToolInputError, type ToolContext } from "./types";
import { shortSha, truncate } from "./util";

function need(ctx: ToolContext) {
  if (!ctx.repo || !ctx.sha) throw new ToolInputError("No repository is connected to this incident.");
  return { repo: ctx.repo, sha: ctx.sha };
}

export const getRecentCommits = defineTool({
  name: "get_recent_commits",
  description:
    "List recent commits on the investigated ref, optionally only those touching a path. Useful to check whether a recent change introduced the bug.",
  kind: "read",
  needsRepo: true,
  schema: z.object({
    path: z.string().optional().describe("file or directory to filter by"),
    limit: z.number().int().min(1).max(30).optional(),
  }),
  label: (i) => `Inspecting recent commits${i.path ? ` touching ${i.path}` : ""}`,
  async run(input, ctx) {
    const { repo, sha } = need(ctx);
    try {
      const { data } = await readClient().repos.listCommits({
        owner: repo.owner,
        repo: repo.name,
        sha,
        path: input.path,
        per_page: input.limit ?? 10,
      });
      if (!data.length) return { output: "No commits found.", summary: "No commits found" };
      const lines = data.map(
        (c) =>
          `${shortSha(c.sha)} ${c.commit.author?.date?.slice(0, 10) ?? ""} ${c.commit.author?.name ?? c.author?.login ?? "?"}: ${truncate(c.commit.message.split("\n")[0], 120)}`,
      );
      return { output: lines.join("\n"), summary: `${data.length} commit(s); latest ${lines[0].slice(0, 60)}` };
    } catch (err) {
      throw toGitHubError(err, "list commits");
    }
  },
});

export const getCommit = defineTool({
  name: "get_commit",
  description: "Show a commit's message, changed files and patch (patches truncated). Optionally filter to one path.",
  kind: "read",
  needsRepo: true,
  schema: z.object({
    sha: z.string().min(4).max(40).regex(/^[0-9a-f]+$/i),
    path: z.string().optional(),
  }),
  label: (i) => `Inspecting commit ${shortSha(i.sha)}`,
  async run(input, ctx) {
    const { repo } = need(ctx);
    try {
      const { data } = await readClient().repos.getCommit({ owner: repo.owner, repo: repo.name, ref: input.sha });
      const files = (data.files ?? []).filter((f) => !input.path || f.filename.startsWith(input.path));
      let budget = 12_000;
      const parts = files.map((f) => {
        const patch = f.patch ? truncate(f.patch, Math.max(400, Math.min(4000, budget))) : "(no textual patch)";
        budget -= patch.length;
        return `--- ${f.filename} (${f.status}, +${f.additions}/-${f.deletions})\n${budget > 0 ? patch : "(patch omitted)"}`;
      });
      return {
        output:
          `commit ${data.sha}\nauthor: ${data.commit.author?.name} <${data.commit.author?.email}> ${data.commit.author?.date}\n\n${data.commit.message}\n\n` +
          parts.join("\n\n"),
        summary: `${truncate(data.commit.message.split("\n")[0], 80)} (${files.length} file(s))`,
      };
    } catch (err) {
      throw toGitHubError(err, `read commit ${input.sha}`);
    }
  },
});

export const getBranch = defineTool({
  name: "get_branch",
  description: "Get a branch's head commit. Defaults to the branch being investigated.",
  kind: "read",
  needsRepo: true,
  schema: z.object({ name: z.string().optional() }),
  label: (i) => `Reading branch ${i.name ?? "(current)"}`,
  async run(input, ctx) {
    const { repo } = need(ctx);
    const name = input.name ?? ctx.ref ?? ctx.repository?.default_branch ?? "main";
    try {
      const { data } = await readClient().repos.getBranch({ owner: repo.owner, repo: repo.name, branch: name });
      return {
        output: `branch ${data.name}\nhead ${data.commit.sha}\n${data.commit.commit.author?.date ?? ""} ${truncate(data.commit.commit.message.split("\n")[0], 120)}\nprotected: ${data.protected}`,
        summary: `${data.name} @ ${shortSha(data.commit.sha)}`,
      };
    } catch (err) {
      throw toGitHubError(err, `read branch ${name}`);
    }
  },
});

export const queryLogs = defineTool({
  name: "query_logs",
  description:
    "Search the logs attached to this incident. Filter by level and/or a substring. Returns log lines with their line numbers.",
  kind: "read",
  needsRepo: false,
  schema: z.object({
    level: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).optional(),
    contains: z.string().max(200).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  label: (i) => `Inspecting logs${i.level ? ` (${i.level})` : ""}${i.contains ? ` for "${truncate(i.contains, 40)}"` : ""}`,
  async run(input, ctx) {
    if (!ctx.db || !ctx.incident) throw new ToolInputError("No incident logs available.");
    let q = ctx.db
      .from("incident_logs")
      .select("line_no, level, message, logged_at, source")
      .eq("incident_id", ctx.incident.id)
      .eq("user_id", ctx.userId)
      .order("line_no")
      .limit(input.limit ?? 80);
    if (input.level) q = q.eq("level", input.level);
    if (input.contains) q = q.ilike("message", `%${input.contains.replace(/[%_]/g, "\\$&")}%`);
    const { data, error } = await q;
    if (error) throw new Error(`Could not read logs: ${error.message}`);
    if (!data?.length) return { output: "No matching log lines.", summary: "No matching log lines" };
    return {
      output: data
        .map((l) => `#${l.line_no} ${l.logged_at ?? ""} ${(l.level ?? "").toUpperCase()} ${truncate(l.message, 400)}`.replace(/\s+/g, " ").trim())
        .join("\n"),
      summary: `${data.length} log line(s)`,
    };
  },
});

// --- Write tools (never offered to the agent) -------------------------------

export const createBranch = defineTool({
  name: "create_branch",
  description: "Create a branch from a base commit.",
  kind: "write",
  needsRepo: true,
  schema: z.object({ branch: z.string().min(1).max(200), from_sha: z.string().min(7).max(40) }),
  label: (i) => `Creating branch ${i.branch}`,
  async run(input, ctx) {
    const { repo } = need(ctx);
    try {
      await writeClient().git.createRef({ owner: repo.owner, repo: repo.name, ref: `refs/heads/${input.branch}`, sha: input.from_sha });
      return { output: `created ${input.branch}`, summary: `Branch ${input.branch} from ${shortSha(input.from_sha)}` };
    } catch (err) {
      throw toGitHubError(err, `create branch ${input.branch}`);
    }
  },
});

export const updateFile = defineTool({
  name: "update_file",
  description: "Commit new content for one file on a branch.",
  kind: "write",
  needsRepo: true,
  schema: z.object({ branch: z.string(), path: z.string(), content: z.string(), message: z.string() }),
  label: (i) => `Committing ${i.path}`,
  async run(input, ctx) {
    const { repo } = need(ctx);
    const gh = writeClient();
    let sha: string | undefined;
    try {
      const { data } = await gh.repos.getContent({ owner: repo.owner, repo: repo.name, path: input.path, ref: input.branch });
      if (!Array.isArray(data) && data.type === "file") sha = data.sha;
    } catch (err) {
      if ((err as { status?: number }).status !== 404) throw toGitHubError(err, `read ${input.path}`);
    }
    try {
      const { data } = await gh.repos.createOrUpdateFileContents({
        owner: repo.owner,
        repo: repo.name,
        path: input.path,
        branch: input.branch,
        message: input.message,
        content: Buffer.from(input.content, "utf8").toString("base64"),
        sha,
      });
      return { output: `committed ${data.commit.sha}`, summary: `${sha ? "Updated" : "Created"} ${input.path} (${shortSha(data.commit.sha ?? "")})` };
    } catch (err) {
      throw toGitHubError(err, `commit ${input.path}`);
    }
  },
});

export const createPullRequest = defineTool({
  name: "create_pull_request",
  description: "Open a pull request.",
  kind: "write",
  needsRepo: true,
  schema: z.object({ head: z.string(), base: z.string(), title: z.string(), body: z.string() }),
  label: (i) => `Opening pull request "${truncate(i.title, 60)}"`,
  async run(input, ctx) {
    const { repo } = need(ctx);
    try {
      const { data } = await writeClient().pulls.create({
        owner: repo.owner,
        repo: repo.name,
        head: input.head,
        base: input.base,
        title: input.title,
        body: input.body,
      });
      return { output: JSON.stringify({ number: data.number, url: data.html_url }), summary: `PR #${data.number} opened` };
    } catch (err) {
      throw toGitHubError(err, "open the pull request");
    }
  },
});

export const gitTools = [getRecentCommits, getCommit, getBranch];
export const writeTools = [createBranch, updateFile, createPullRequest];
