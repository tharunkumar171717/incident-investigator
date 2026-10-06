import "server-only";
import type { IncidentRow, InvestigationRow, PullRequestRow, RepositoryRow, RootCauseFindingRow, SuggestedFixRow, TestResultRow } from "@/lib/db/types";
import { adminClient } from "@/lib/supabase/admin";
import { executeTool } from "@/lib/tools/registry";
import type { ToolContext } from "@/lib/tools/types";
import { shortSha, truncate } from "@/lib/tools/util";
import { StepRecorder } from "./recorder";

export class PullRequestError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/**
 * Creates a branch from the investigated commit, commits the proposed fix and
 * test files, and opens a PR. Only called after the user confirmed the diff in
 * the UI, or for incidents where the user enabled auto-fix. Every GitHub call
 * is recorded in the investigation timeline.
 */
export async function createPullRequestForInvestigation(opts: {
  investigationId: string;
  userId: string;
  fixId: string;
  trigger: "manual" | "auto";
}): Promise<PullRequestRow> {
  const db = adminClient();
  const { data: inv } = await db.from("investigations").select("*").eq("id", opts.investigationId).eq("user_id", opts.userId).single<InvestigationRow>();
  if (!inv) throw new PullRequestError("not_found", "Investigation not found.", 404);
  if (inv.status !== "completed") throw new PullRequestError("not_ready", "The investigation has not completed.");
  if (!inv.repository_id || !inv.commit_sha) throw new PullRequestError("no_repo", "This investigation has no repository snapshot.");

  const [{ data: fix }, { data: repository }, { data: incident }, { data: finding }, { data: tests }, { data: existing }] = await Promise.all([
    db.from("suggested_fixes").select("*").eq("id", opts.fixId).eq("investigation_id", inv.id).single<SuggestedFixRow>(),
    db.from("repositories").select("*").eq("id", inv.repository_id).eq("user_id", opts.userId).single<RepositoryRow>(),
    db.from("incidents").select("*").eq("id", inv.incident_id).single<IncidentRow>(),
    db.from("root_cause_findings").select("*").eq("investigation_id", inv.id).maybeSingle<RootCauseFindingRow>(),
    db.from("test_results").select("*").eq("investigation_id", inv.id).order("created_at", { ascending: false }).returns<TestResultRow[]>(),
    db.from("pull_requests").select("*").eq("investigation_id", inv.id).in("status", ["creating", "open"]).returns<PullRequestRow[]>(),
  ]);
  if (!fix) throw new PullRequestError("not_found", "Proposed fix not found.", 404);
  if (!repository) throw new PullRequestError("no_repo", "The repository is no longer connected.");
  if (!fix.changes.some((c) => c.kind === "fix")) throw new PullRequestError("no_fix", "The proposal contains no code fix.");
  if (existing?.length) throw new PullRequestError("exists", "A pull request already exists (or is being created) for this investigation.", 409);

  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const branch = `ai-fix/incident-${inv.incident_id.slice(0, 8)}-${stamp}`;
  const base = incident?.branch || repository.default_branch;
  const title = `fix: ${truncate(incident?.title ?? "incident fix", 90)}`;

  const { data: pr, error } = await db
    .from("pull_requests")
    .insert({
      investigation_id: inv.id,
      fix_id: fix.id,
      repository_id: repository.id,
      user_id: opts.userId,
      status: "creating",
      trigger: opts.trigger,
      branch,
      base_branch: base,
      title,
    })
    .select("*")
    .single<PullRequestRow>();
  if (error || !pr) throw new PullRequestError("db_error", "Could not record the pull request.", 500);

  const rec = await StepRecorder.resume(db, inv.id, opts.userId);
  await rec.add("milestone", opts.trigger === "auto" ? "Creating pull request (auto-fix enabled)" : "Creating pull request (confirmed by user)", {
    detail: `${fix.changes.length} file(s) → ${repository.full_name}:${base}`,
  });

  const ctx: ToolContext = {
    userId: opts.userId,
    investigationId: inv.id,
    incident: incident ?? null,
    repository,
    repo: { owner: repository.owner, name: repository.name },
    ref: base,
    sha: inv.commit_sha,
    workspace: async () => {
      throw new Error("not needed");
    },
    db,
    state: { fixId: fix.id, fixDescription: fix.description, changes: fix.changes, lastTest: null, report: null },
    signal: new AbortController().signal,
  };

  const step = async (name: string, input: Record<string, unknown>) => {
    const done = await rec.start("tool_call", name, { name, input: redact(input) });
    const ex = await executeTool(name, input, ctx, 60_000);
    await done(ex.result.isError ? "error" : "success", { title: ex.title, detail: ex.result.summary, output: truncate(ex.result.output, 4000) });
    if (ex.result.isError) throw new PullRequestError(ex.errorCode ?? "github_error", ex.result.output, 502);
    return ex.result.output;
  };

  try {
    await step("create_branch", { branch, from_sha: inv.commit_sha });
    for (const change of fix.changes) {
      await step("update_file", {
        branch,
        path: change.path,
        content: change.updated,
        message: `${change.kind === "test" ? "test" : "fix"}: ${change.path}\n\nProposed by AI incident investigation ${inv.id}.`,
      });
    }
    const out = await step("create_pull_request", { head: branch, base, title, body: prBody({ inv, incident, finding, fix, tests: tests ?? [] }) });
    const { number, url } = JSON.parse(out) as { number: number; url: string };
    const { data: updated } = await db.from("pull_requests").update({ status: "open", number, url }).eq("id", pr.id).select("*").single<PullRequestRow>();
    await db.from("suggested_fixes").update({ status: "applied" }).eq("id", fix.id);
    await db.from("incidents").update({ status: "fix_proposed" }).eq("id", inv.incident_id);
    await rec.add("milestone", `PR #${number} created`, { detail: url });
    return updated ?? pr;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.from("pull_requests").update({ status: "failed", error: message }).eq("id", pr.id);
    await rec.add("error", "Pull request creation failed", { detail: message });
    throw err instanceof PullRequestError ? err : new PullRequestError("github_error", message, 502);
  }
}

function redact(input: Record<string, unknown>) {
  return "content" in input ? { ...input, content: `(${String(input.content).length} chars)` } : input;
}

function prBody(o: {
  inv: InvestigationRow;
  incident: IncidentRow | null;
  finding: RootCauseFindingRow | null;
  fix: SuggestedFixRow;
  tests: TestResultRow[];
}) {
  const lines = [`## Incident`, o.incident?.title ?? "", o.incident?.endpoint ? `Endpoint: \`${o.incident.endpoint}\`` : ""];
  if (o.finding) {
    lines.push(
      "",
      "## Root cause",
      o.finding.root_cause,
      "",
      `Severity: **${o.finding.severity}** · Confidence: **${o.finding.confidence}%**`,
      "",
      "## Evidence",
      ...o.finding.evidence.map((e) => `- ${e.description} (\`${e.source}\`)`),
    );
  }
  lines.push("", "## Change", o.fix.description, "", ...o.fix.changes.map((c) => `- \`${c.path}\` (${c.kind}${c.original === null ? ", new" : ""})`));
  lines.push("", "## Verification");
  if (!o.tests.length) lines.push("Tests were not run by the investigation.");
  for (const t of o.tests.slice(0, 5)) lines.push(`- \`${t.command}\`: **${t.status}**${t.exit_code !== null ? ` (exit ${t.exit_code})` : ""}`);
  lines.push("", `---`, `Generated by AI incident investigation \`${o.inv.id}\` from commit ${shortSha(o.inv.commit_sha ?? "")}. Review carefully before merging.`);
  return lines.filter((l) => l !== undefined).join("\n");
}
