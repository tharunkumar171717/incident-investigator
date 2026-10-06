import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { getProvider, ProviderError } from "@/lib/ai";
import type { ToolResultMessage } from "@/lib/ai/types";
import type { CodeReference, IncidentRow, InvestigationReport, InvestigationRow, RepositoryRow } from "@/lib/db/types";
import { resolveRef, type RepoRef } from "@/lib/github/client";
import { GitHubError } from "@/lib/github/errors";
import { getWorkspace, readText, type Workspace } from "@/lib/github/workspace";
import { adminClient } from "@/lib/supabase/admin";
import { agentTools, executeTool, getTool, toJsonSpec } from "@/lib/tools/registry";
import type { InvestigationState, ToolContext } from "@/lib/tools/types";
import { basename, languageFor, shortSha, truncate } from "@/lib/tools/util";
import { parseStackTrace, type ParsedLogLine } from "./parse";
import { buildIncidentBrief, LIMIT_NOTE, MISSING_REPORT_NOTE, SYSTEM_PROMPT, WRAP_UP_NOTE } from "./prompt";
import { createPullRequestForInvestigation } from "./pull-request";
import { StepRecorder } from "./recorder";
import { reportSchema, type ReportInput } from "./report-schema";

// Investigations running in this server process, for immediate cancellation.
const g = globalThis as unknown as { __iiActive?: Map<string, AbortController> };
const active = (g.__iiActive ??= new Map());

export function isRunningHere(id: string) {
  return active.has(id);
}

export function abortLocal(id: string) {
  active.get(id)?.abort(new InvestigationFailure("cancelled", "Cancelled by user."));
}

class InvestigationFailure extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Runs one investigation end to end. Safe to call in the background (after());
 * it never throws and always leaves the investigation in a terminal state.
 */
export async function runInvestigation(investigationId: string): Promise<void> {
  if (active.has(investigationId)) return;
  const controller = new AbortController();
  active.set(investigationId, controller);
  const db = adminClient();
  const started = Date.now();
  let inv: InvestigationRow | null = null;
  let rec: StepRecorder | null = null;

  try {
    const loaded = await load(db, investigationId);
    inv = loaded.inv;
    const { incident, repository } = loaded;
    rec = new StepRecorder(db, inv.id, inv.user_id);

    // Claim the run atomically so two workers never run the same investigation.
    const { data: claimed } = await db
      .from("investigations")
      .update({ status: "running", started_at: new Date(started).toISOString(), heartbeat_at: new Date().toISOString() })
      .eq("id", inv.id)
      .eq("status", "queued")
      .select("id");
    if (!claimed?.length) return;
    await db.from("incidents").update({ status: "investigating" }).eq("id", incident.id);

    await investigate({ db, inv, incident, repository, rec, controller, started });
  } catch (err) {
    const reason = controller.signal.aborted ? controller.signal.reason : null;
    const failure =
      reason instanceof InvestigationFailure
        ? reason
        : controller.signal.aborted
          ? new InvestigationFailure("cancelled", "Cancelled by user.")
          : err instanceof InvestigationFailure
        ? err
        : err instanceof GitHubError
          ? new InvestigationFailure(err.code, err.message)
          : err instanceof ProviderError
            ? new InvestigationFailure(err.code, err.message)
            : new InvestigationFailure("internal", `Unexpected error: ${(err as Error)?.message ?? String(err)}`);
    if (!(err instanceof InvestigationFailure) && !(err instanceof GitHubError) && !(err instanceof ProviderError)) {
      console.error("[runner] investigation crashed", err);
    }
    const cancelled = failure.code === "cancelled";
    await rec?.add(cancelled ? "warning" : "error", cancelled ? "Investigation cancelled" : "Investigation failed", { detail: failure.message }).catch(() => {});
    await db
      .from("investigations")
      .update({
        status: cancelled ? "cancelled" : "failed",
        outcome: "error",
        error: failure.message,
        error_code: cancelled ? "cancelled" : failure.code,
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - started,
      })
      .eq("id", investigationId);
    if (inv) await db.from("incidents").update({ status: "open" }).eq("id", inv.incident_id).eq("status", "investigating");
  } finally {
    active.delete(investigationId);
  }
}

async function load(db: SupabaseClient, id: string) {
  const { data: inv, error } = await db.from("investigations").select("*").eq("id", id).single<InvestigationRow>();
  if (error || !inv) throw new InvestigationFailure("not_found", "Investigation not found.");
  const { data: incident } = await db.from("incidents").select("*").eq("id", inv.incident_id).eq("user_id", inv.user_id).single<IncidentRow>();
  if (!incident) throw new InvestigationFailure("not_found", "Incident not found.");
  let repository: RepositoryRow | null = null;
  if (inv.repository_id) {
    const { data } = await db.from("repositories").select("*").eq("id", inv.repository_id).eq("user_id", inv.user_id).single<RepositoryRow>();
    repository = data ?? null;
  }
  return { inv, incident, repository };
}

interface RunArgs {
  db: SupabaseClient;
  inv: InvestigationRow;
  incident: IncidentRow;
  repository: RepositoryRow | null;
  rec: StepRecorder;
  controller: AbortController;
  started: number;
}

async function investigate({ db, inv, incident, repository, rec, controller, started }: RunArgs) {
  const cfg = env();
  const signal = controller.signal;
  const deadline = started + cfg.AGENT_MAX_DURATION_SECONDS * 1000;
  const timer = setTimeout(() => controller.abort(new InvestigationFailure("timeout", "Investigation exceeded the maximum duration.")), cfg.AGENT_MAX_DURATION_SECONDS * 1000);

  try {
    // 1. Understand the incident -------------------------------------------
    await rec.add("milestone", "Analyzing incident", { detail: incident.endpoint ? `Endpoint ${incident.endpoint}` : null });

    const stack = parseStackTrace(incident.stack_trace);
    if (!incident.stack_trace?.trim()) {
      await rec.add("warning", "No stack trace provided", { detail: "Investigating from the error message, endpoint and logs." });
    } else if (!stack || stack.frames.length === 0) {
      await rec.add("warning", "Stack trace could not be parsed", { detail: "No recognisable frames; the raw trace is still given to the agent." });
    } else {
      const top = stack.frames[0];
      await rec.add("milestone", "Parsed stack trace", {
        detail: `${stack.runtime} · ${stack.frames.length} application frame(s)${stack.errorType ? ` · ${stack.errorType}` : ""} · innermost ${basename(top.file)}${top.line ? `:${top.line}` : ""}${top.func ? ` in ${top.func}` : ""}`,
      });
    }

    // 2. Logs ------------------------------------------------------------
    const { data: logRows } = await db
      .from("incident_logs")
      .select("line_no, level, message, logged_at, source")
      .eq("incident_id", incident.id)
      .order("line_no")
      .limit(5000);
    const logs = (logRows ?? []) as ParsedLogLine[];
    const byLevel: Record<string, number> = {};
    for (const l of logs) byLevel[l.level ?? "unleveled"] = (byLevel[l.level ?? "unleveled"] ?? 0) + 1;
    const errorSample = logs.filter((l) => l.level === "error" || l.level === "fatal").slice(0, 15);
    if (logs.length) {
      await rec.add("milestone", `Loaded ${logs.length} log line(s)`, {
        detail: Object.entries(byLevel).map(([k, v]) => `${k}: ${v}`).join(" · "),
      });
    }

    // 3. Repository snapshot ---------------------------------------------
    let repo: RepoRef | null = null;
    let sha: string | null = null;
    let ref: string | null = null;
    let workspace: Workspace | null = null;
    if (repository) {
      repo = { owner: repository.owner, name: repository.name };
      ref = incident.commit_sha || incident.branch || repository.default_branch;
      const done = await rec.start("tool_call", `Resolving ${repository.full_name}@${ref}`, { name: "get_branch", input: { ref } });
      try {
        sha = await resolveRef(repo, ref);
        await done("success", { detail: `${ref} → ${shortSha(sha)}` });
      } catch (err) {
        await done("error", { detail: (err as Error).message });
        throw err;
      }
      const fetchDone = await rec.start("tool_call", "Fetching repository snapshot", { name: "list_repository_files", input: { sha } });
      try {
        workspace = await getWorkspace(repo, sha);
        await fetchDone("success", { detail: `${workspace.files.length} indexable file(s) at ${shortSha(sha)}` });
      } catch (err) {
        await fetchDone("error", { detail: (err as Error).message });
        throw err;
      }
      await db.from("investigations").update({ ref, commit_sha: sha }).eq("id", inv.id);
    } else {
      await rec.add("warning", "No repository connected", { detail: "Code cannot be inspected; the agent will use incident data and logs only." });
    }

    // 4. Agent loop --------------------------------------------------------
    const provider = getProvider();
    const tools = agentTools({ hasRepo: Boolean(workspace) });
    const session = provider.startSession({ system: SYSTEM_PROMPT, tools: tools.map(toJsonSpec) });
    const state: InvestigationState = { fixId: null, fixDescription: null, changes: [], lastTest: null, report: null };
    const ctx: ToolContext = {
      userId: inv.user_id,
      investigationId: inv.id,
      incident,
      repository,
      repo,
      ref,
      sha,
      workspace: async () => {
        if (!workspace) throw new InvestigationFailure("no_repo", "No repository snapshot.");
        return workspace;
      },
      db,
      state,
      signal,
    };

    const topLevel = workspace ? [...new Set(workspace.files.map((f) => f.split("/")[0] + (f.includes("/") ? "/" : "")))] : [];
    let userText: string | undefined = buildIncidentBrief({
      incident,
      repository,
      ref,
      sha,
      fileCount: workspace?.files.length ?? null,
      topLevel,
      stack,
      logs: { total: logs.length, byLevel, sample: errorSample },
      testExecution: cfg.ENABLE_TEST_EXECUTION,
    });
    let toolResults: ToolResultMessage[] | undefined;
    let steps = 0;
    let toolCalls = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let wrapUpSent = false;
    let limitMode = false;
    let limitNoteSent = false;
    let limitTurns = 0;
    let nudges = 0;
    const seenCalls = new Map<string, number>();

    await rec.add("milestone", "Investigation agent started", { detail: `${provider.name} · ${provider.model} · ${tools.length} tools` });

    while (!state.report) {
      if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new InvestigationFailure("cancelled", "Cancelled.");
      await checkCancelled(db, inv.id, controller);

      const thinking = await rec.start("thought", steps === 0 ? "Planning investigation" : "Reviewing results");
      let turn;
      try {
        turn = await session.next({ userText, toolResults, signal });
      } catch (err) {
        await thinking("error", { detail: (err as Error).message });
        throw err;
      }
      steps++;
      inputTokens += turn.usage.inputTokens;
      outputTokens += turn.usage.outputTokens;
      const thoughtText = [...turn.thoughts, turn.text.trim()].filter(Boolean).join("\n\n");
      await thinking("success", {
        title: thoughtText ? truncate(firstLine(thoughtText), 140) : steps === 1 ? "Planned investigation" : "Decided next action",
        detail: thoughtText ? truncate(thoughtText, 6000) : null,
      });

      userText = undefined;
      toolResults = [];
      for (const call of turn.toolCalls) {
        if (turn.stop === "max_tokens") {
          toolResults.push({ id: call.id, name: call.name, output: "Your tool input was cut off by the output limit and was not executed. Retry with a smaller input (e.g. fewer or shorter edits).", isError: true });
          continue;
        }
        if (limitMode && call.name !== "submit_report") {
          toolResults.push({ id: call.id, name: call.name, output: "Limit reached: only submit_report is allowed now.", isError: true });
          continue;
        }
        const key = `${call.name}:${stableJson(call.input)}`;
        const repeats = (seenCalls.get(key) ?? 0) + 1;
        seenCalls.set(key, repeats);
        if (repeats > 1 && call.name !== "run_tests") {
          await rec.add("warning", `Skipped repeated ${call.name} call`, { detail: "Identical call already executed; the agent was asked to reuse the earlier result." });
          toolResults.push({ id: call.id, name: call.name, output: "You already made this exact call. Reuse the earlier result and try a different approach.", isError: true });
          if (repeats > 3) limitMode = true; // stuck in a loop
          continue;
        }

        toolCalls++;
        const executedTitle = safeLabel(call.name, call.input);
        const done = await rec.start("tool_call", executedTitle, { name: call.name, input: call.input });
        const ex = await executeTool(call.name, call.input, ctx, cfg.TOOL_TIMEOUT_SECONDS * 1000);
        await done(ex.result.isError ? "error" : "success", {
          title: ex.title,
          detail: ex.result.summary,
          output: truncate(ex.result.output, 20_000),
        });
        toolResults.push({ id: call.id, name: call.name, output: ex.result.output, isError: Boolean(ex.result.isError) });

        if (ex.errorCode === "github_auth_failed" || ex.errorCode === "github_rate_limited") {
          throw new InvestigationFailure(ex.errorCode, ex.result.output);
        }
        if (!ex.result.isError) await milestoneFor(call.name, call.input, state, rec);
      }

      await db
        .from("investigations")
        .update({ step_count: steps, tool_call_count: toolCalls, input_tokens: inputTokens, output_tokens: outputTokens, heartbeat_at: new Date().toISOString() })
        .eq("id", inv.id);

      if (state.report) break;

      const notes: string[] = [];
      if (turn.stop === "max_tokens") {
        if (!turn.toolCalls.length) notes.push("Operator note: your last response hit the output limit. Be more concise.");
      } else if (!turn.toolCalls.length) {
        if (nudges++ < 2) notes.push(MISSING_REPORT_NOTE);
        else throw new InvestigationFailure("no_report", "The agent stopped without submitting a report.");
      }

      const overLimit =
        steps >= cfg.AGENT_MAX_STEPS || toolCalls >= cfg.AGENT_MAX_TOOL_CALLS || inputTokens + outputTokens >= cfg.AGENT_MAX_TOKENS || Date.now() > deadline - 45_000;
      const nearLimit =
        steps >= cfg.AGENT_MAX_STEPS - 3 ||
        toolCalls >= cfg.AGENT_MAX_TOOL_CALLS - 5 ||
        inputTokens + outputTokens >= cfg.AGENT_MAX_TOKENS * 0.8 ||
        Date.now() > deadline - 120_000;
      if (overLimit) limitMode = true;
      if (limitMode && limitNoteSent && ++limitTurns >= 2) {
        throw new InvestigationFailure("limit_reached", `Investigation limits reached (${steps} steps, ${toolCalls} tool calls, ${inputTokens + outputTokens} tokens) without a report.`);
      }
      if (limitMode && !limitNoteSent) {
        // Reached a hard limit (or got stuck repeating calls): one last chance to report.
        limitNoteSent = true;
        notes.push(LIMIT_NOTE);
        await rec.add("warning", overLimit ? "Investigation limit reached" : "Agent is repeating itself", {
          detail: `${steps} steps · ${toolCalls} tool calls · ${(inputTokens + outputTokens).toLocaleString()} tokens. Asking the agent to report.`,
        });
      } else if (nearLimit && !wrapUpSent) {
        wrapUpSent = true;
        notes.push(WRAP_UP_NOTE);
      }
      if (notes.length) userText = notes.join("\n");
      if (!toolResults.length) toolResults = undefined;
    }

    // 5. Finalize --------------------------------------------------------
    await finalize({ db, inv, incident, repository, rec, workspace, state, report: state.report!, started, counters: { steps, toolCalls, inputTokens, outputTokens } });
  } finally {
    clearTimeout(timer);
  }
}

async function milestoneFor(name: string, input: unknown, state: InvestigationState, rec: StepRecorder) {
  if (name === "run_tests" && state.lastTest) {
    const mode = (input as { mode?: string }).mode;
    const s = state.lastTest.status;
    if (mode === "with_fix" && s === "passed") await rec.add("milestone", "Fix verified", { detail: `${state.lastTest.command} passed with the fix applied` });
    else if (mode === "with_fix" && s === "failed") await rec.add("warning", "Tests failing with fix applied", { detail: state.lastTest.command });
    else if (mode === "without_fix" && s === "failed") await rec.add("milestone", "Bug reproduced by regression test", { detail: "Test fails without the fix, as expected" });
    else if (mode === "without_fix" && s === "passed") await rec.add("warning", "Regression test passes without the fix", { detail: "The test may not reproduce the bug" });
  }
}

async function finalize(args: {
  db: SupabaseClient;
  inv: InvestigationRow;
  incident: IncidentRow;
  repository: RepositoryRow | null;
  rec: StepRecorder;
  workspace: Workspace | null;
  state: InvestigationState;
  report: ReportInput;
  started: number;
  counters: { steps: number; toolCalls: number; inputTokens: number; outputTokens: number };
}) {
  const { db, inv, incident, rec, workspace, state, started } = args;
  const parsed = reportSchema.parse(args.report);
  const codeRefs = await attachSnippets(parsed.code_references, workspace);
  const report: InvestigationReport = { ...parsed, code_references: codeRefs };

  if (report.root_cause_found) {
    await rec.add("milestone", "Root cause identified", { detail: `${report.severity} · ${report.confidence}% confidence · ${truncate(report.root_cause, 220)}` });
  } else {
    await rec.add("warning", "Root cause not established", { detail: truncate(report.summary, 300) });
  }

  const { error: findingError } = await db.from("root_cause_findings").upsert(
    {
      investigation_id: inv.id,
      user_id: inv.user_id,
      root_cause_found: report.root_cause_found,
      summary: report.summary,
      root_cause: report.root_cause,
      severity: report.severity,
      confidence: report.confidence,
      affected_service: report.affected_service,
      affected_endpoint: report.affected_endpoint,
      evidence: report.evidence,
      affected_files: report.affected_files,
      call_chain: report.call_chain,
      code_references: report.code_references,
      tests_to_add: report.tests_to_add,
      suggested_fix: report.suggested_fix,
      risk: report.risk,
      recommended_action: report.recommended_action,
    },
    { onConflict: "investigation_id" },
  );
  if (findingError) throw new InvestigationFailure("db_error", `Could not save findings: ${findingError.message}`);

  const hasFix = state.changes.some((c) => c.kind === "fix");
  await db
    .from("investigations")
    .update({
      status: "completed",
      outcome: report.root_cause_found ? "root_cause_found" : "inconclusive",
      result: report,
      step_count: args.counters.steps,
      tool_call_count: args.counters.toolCalls,
      input_tokens: args.counters.inputTokens,
      output_tokens: args.counters.outputTokens,
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
    })
    .eq("id", inv.id);
  await db
    .from("incidents")
    .update({
      severity: report.severity,
      status: report.root_cause_found ? (hasFix ? "fix_proposed" : "root_cause_identified") : "open",
    })
    .eq("id", incident.id);
  await rec.add("milestone", "Investigation complete", {
    detail: `${args.counters.steps} steps · ${args.counters.toolCalls} tool calls · ${((Date.now() - started) / 1000).toFixed(0)}s`,
  });

  // Optional automatic PR: only when the user opted in on this incident, a fix
  // exists, and it was verified (or execution is unavailable and confidence is high).
  if (incident.auto_fix && hasFix && state.fixId && report.root_cause_found) {
    const verified = state.lastTest?.status === "passed";
    const unverifiable = !env().ENABLE_TEST_EXECUTION && report.confidence >= 80;
    if (verified || unverifiable) {
      await createPullRequestForInvestigation({ investigationId: inv.id, userId: inv.user_id, fixId: state.fixId, trigger: "auto" }).catch((err) =>
        console.error("[runner] auto PR failed", err),
      );
    } else {
      await rec.add("warning", "Automatic PR skipped", { detail: "The fix was not verified by passing tests. Review it and create the PR manually." });
    }
  }
}

/** Replaces model-supplied line ranges with real code from the snapshot. */
async function attachSnippets(refs: ReportInput["code_references"], ws: Workspace | null): Promise<CodeReference[]> {
  const out: CodeReference[] = [];
  for (const r of refs) {
    const ref: CodeReference = { ...r, language: languageFor(r.path) };
    if (!ws) {
      out.push({ ...ref, missing: true });
      continue;
    }
    let text: string | null = null;
    try {
      text = await readText(ws, r.path);
    } catch {
      text = null;
    }
    if (text === null) {
      out.push({ ...ref, missing: true });
      continue;
    }
    const lines = text.split(/\r?\n/);
    const start = Math.max(1, Math.min(r.start_line, lines.length));
    const end = Math.max(start, Math.min(r.end_line, start + 59, lines.length));
    out.push({ ...ref, start_line: start, end_line: end, code: lines.slice(start - 1, end).join("\n") });
  }
  return out;
}

async function checkCancelled(db: SupabaseClient, id: string, controller: AbortController) {
  const { data } = await db.from("investigations").select("cancel_requested").eq("id", id).single();
  if (data?.cancel_requested) {
    const failure = new InvestigationFailure("cancelled", "Cancelled by user.");
    controller.abort(failure);
    throw failure;
  }
}

function safeLabel(name: string, input: unknown) {
  const tool = getTool(name);
  const parsed = tool?.schema.safeParse(input ?? {});
  return tool && parsed?.success ? tool.label(parsed.data) : `Calling ${name}`;
}

function firstLine(s: string) {
  return s.split("\n").find((l) => l.trim())?.replace(/^[#*\s-]+/, "") ?? s;
}

function stableJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  return `{${Object.keys(v as object)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}

/** Marks runs whose worker died (server restart) as failed so the user can retry. */
export async function failStaleInvestigations(db: SupabaseClient, userId: string) {
  const cutoff = new Date(Date.now() - (env().AGENT_MAX_DURATION_SECONDS + 180) * 1000).toISOString();
  const { data } = await db
    .from("investigations")
    .select("id, incident_id, status, heartbeat_at, created_at")
    .eq("user_id", userId)
    .in("status", ["queued", "running"]);
  for (const row of data ?? []) {
    if (isRunningHere(row.id)) continue;
    const last = row.heartbeat_at ?? row.created_at;
    if (last < cutoff) {
      await db
        .from("investigations")
        .update({ status: "failed", outcome: "error", error: "The investigation worker stopped unexpectedly (server restart?). Retry the investigation.", error_code: "interrupted", completed_at: new Date().toISOString() })
        .eq("id", row.id)
        .in("status", ["queued", "running"]);
      await db.from("incidents").update({ status: "open" }).eq("id", row.incident_id).eq("status", "investigating");
    }
  }
}
