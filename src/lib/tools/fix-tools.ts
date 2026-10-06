import "server-only";
import { createTwoFilesPatch } from "diff";
import { z } from "zod";
import { env } from "@/lib/env";
import type { FileChange } from "@/lib/db/types";
import { normalizeRepoPath, readText } from "@/lib/github/workspace";
import { reportSchema } from "@/lib/agent/report-schema";
import { runTestsInSandbox } from "./test-runner";
import { defineTool, ToolInputError, type ToolContext } from "./types";
import { truncate } from "./util";

function makeDiff(path: string, original: string | null, updated: string) {
  return createTwoFilesPatch(original === null ? "/dev/null" : `a/${path}`, `b/${path}`, original ?? "", updated, "", "", { context: 3 });
}

async function persistFix(ctx: ToolContext) {
  if (!ctx.db || !ctx.investigationId) return;
  const row = {
    description: ctx.state.fixDescription ?? "Proposed regression test",
    changes: ctx.state.changes,
    status: "proposed" as const,
  };
  if (ctx.state.fixId) {
    const { error } = await ctx.db.from("suggested_fixes").update(row).eq("id", ctx.state.fixId).eq("user_id", ctx.userId);
    if (error) throw new Error(`Could not save the proposed fix: ${error.message}`);
  } else {
    const { data, error } = await ctx.db
      .from("suggested_fixes")
      .insert({ ...row, investigation_id: ctx.investigationId, user_id: ctx.userId })
      .select("id")
      .single();
    if (error) throw new Error(`Could not save the proposed fix: ${error.message}`);
    ctx.state.fixId = data.id;
  }
}

export const proposeFix = defineTool({
  name: "propose_fix",
  description:
    "Propose a code fix as exact search/replace edits against the investigated snapshot. Each `search` must match exactly once in the file (include enough surrounding lines). Calling again replaces the previous proposal. Nothing is committed to GitHub; the user reviews the diff first.",
  kind: "propose",
  needsRepo: true,
  schema: z.object({
    description: z.string().min(10).describe("what the fix changes and why"),
    edits: z
      .array(
        z.object({
          path: z.string().min(1),
          search: z.string().describe("exact existing text to replace; empty string only when creating a new file"),
          replace: z.string(),
        }),
      )
      .min(1)
      .max(20),
  }),
  label: (i) => `Generating fix (${new Set(i.edits.map((e) => e.path)).size} file(s))`,
  async run(input, ctx) {
    const ws = await ctx.workspace();
    const files = new Map<string, { original: string | null; updated: string }>();
    for (const [idx, edit] of input.edits.entries()) {
      const path = normalizeRepoPath(ws, edit.path);
      let entry = files.get(path);
      if (!entry) {
        const original = await readText(ws, path);
        entry = { original, updated: original ?? "" };
        files.set(path, entry);
      }
      if (edit.search === "") {
        if (entry.original !== null) throw new ToolInputError(`Edit ${idx + 1}: empty search is only allowed for new files, but ${path} exists.`);
        entry.updated = edit.replace;
        continue;
      }
      if (entry.original === null) throw new ToolInputError(`Edit ${idx + 1}: ${path} does not exist. Use an empty search to create it.`);
      const count = entry.updated.split(edit.search).length - 1;
      if (count === 0) throw new ToolInputError(`Edit ${idx + 1}: search text not found in ${path}. Re-read the file and copy the exact text, including indentation.`);
      if (count > 1) throw new ToolInputError(`Edit ${idx + 1}: search text matches ${count} times in ${path}; include more surrounding context.`);
      entry.updated = entry.updated.replace(edit.search, () => edit.replace);
    }
    const fixChanges: FileChange[] = [...files].map(([path, f]) => ({
      path,
      kind: "fix",
      original: f.original,
      updated: f.updated,
      diff: makeDiff(path, f.original, f.updated),
    }));
    ctx.state.changes = [...ctx.state.changes.filter((c) => c.kind === "test" && !files.has(c.path)), ...fixChanges];
    ctx.state.fixDescription = input.description;
    await persistFix(ctx);
    return {
      output: `Fix recorded (${fixChanges.length} file(s)). Diff:\n${truncate(fixChanges.map((c) => c.diff).join("\n"), 8000)}`,
      summary: `Proposed changes to ${fixChanges.map((c) => c.path).join(", ")}`,
    };
  },
});

export const writeTest = defineTool({
  name: "write_test",
  description:
    "Add or replace a regression test file (full file content) that fails without the fix and passes with it. Follow the repository's existing test framework and conventions.",
  kind: "propose",
  needsRepo: true,
  schema: z.object({
    path: z.string().min(1).describe("repo-relative test file path"),
    content: z.string().min(1).describe("complete file content"),
    description: z.string().min(5),
  }),
  label: (i) => `Generating regression test ${i.path}`,
  async run(input, ctx) {
    const ws = await ctx.workspace();
    const path = normalizeRepoPath(ws, input.path);
    const existingFix = ctx.state.changes.find((c) => c.path === path && c.kind === "fix");
    if (existingFix) throw new ToolInputError(`${path} is part of the fix; put the test in a separate file.`);
    const original = await readText(ws, path);
    const change: FileChange = { path, kind: "test", original, updated: input.content, diff: makeDiff(path, original, input.content) };
    ctx.state.changes = [...ctx.state.changes.filter((c) => c.path !== path), change];
    if (!ctx.state.fixDescription) ctx.state.fixDescription = input.description;
    await persistFix(ctx);
    return { output: `Test recorded at ${path}.`, summary: `${original === null ? "New" : "Updated"} test ${path}` };
  },
});

export const runTests = defineTool({
  name: "run_tests",
  description:
    "Run the repository's configured test command in an isolated copy of the snapshot with the proposed test (and, in with_fix mode, the fix) applied. Use mode=without_fix first to confirm the test reproduces the bug, then mode=with_fix to verify. Optionally pass a single test file as target.",
  kind: "propose",
  needsRepo: true,
  schema: z.object({
    mode: z.enum(["with_fix", "without_fix"]),
    target: z.string().optional().describe("repo-relative test file to run, e.g. tests/test_orders.py"),
  }),
  label: (i) => (i.mode === "with_fix" ? "Running tests with fix applied" : "Running tests without fix (reproduce bug)"),
  async run(input, ctx) {
    const { ENABLE_TEST_EXECUTION, TEST_TIMEOUT_SECONDS } = env();
    const testCommand = ctx.repository?.test_command ?? null;
    const record = async (status: "passed" | "failed" | "error" | "skipped", command: string, exitCode: number | null, output: string, durationMs: number | null) => {
      ctx.state.lastTest = { status, command, exit_code: exitCode };
      if (!ctx.db || !ctx.investigationId) return;
      await ctx.db.from("test_results").insert({
        investigation_id: ctx.investigationId,
        fix_id: ctx.state.fixId,
        user_id: ctx.userId,
        command: `${command} [${input.mode}]`,
        status,
        exit_code: exitCode,
        output,
        duration_ms: durationMs,
      });
      if (input.mode === "with_fix" && ctx.state.fixId && (status === "passed" || status === "failed")) {
        await ctx.db
          .from("suggested_fixes")
          .update({ status: status === "passed" ? "verified" : "failed_verification" })
          .eq("id", ctx.state.fixId);
      }
    };

    if (!ENABLE_TEST_EXECUTION) {
      const msg = "Test execution is disabled on this server (ENABLE_TEST_EXECUTION=false). Tests were NOT run; do not claim they passed.";
      await record("skipped", testCommand ?? "(none)", null, msg, null);
      return { output: msg, summary: "Skipped: execution disabled", isError: false };
    }
    if (!testCommand) {
      const msg = "No test command is configured for this repository (Repositories → settings). Tests were NOT run.";
      await record("skipped", "(none)", null, msg, null);
      return { output: msg, summary: "Skipped: no test command configured" };
    }
    if (!ctx.state.changes.some((c) => c.kind === "test")) {
      throw new ToolInputError("Write a regression test with write_test before running tests.");
    }
    if (input.mode === "with_fix" && !ctx.state.changes.some((c) => c.kind === "fix")) {
      throw new ToolInputError("Propose a fix with propose_fix before running in with_fix mode.");
    }

    const ws = await ctx.workspace();
    const changes = ctx.state.changes.filter((c) => input.mode === "with_fix" || c.kind === "test");
    const res = await runTestsInSandbox({
      workspace: ws,
      changes,
      setupCommand: ctx.repository?.setup_command ?? null,
      testCommand,
      target: input.target ?? null,
      timeoutMs: TEST_TIMEOUT_SECONDS * 1000,
      signal: ctx.signal,
    });
    if (res.error && !res.test) {
      const out = `${res.error}\n${res.setup?.output ?? ""}`;
      await record("error", res.setup?.command ?? testCommand, res.setup?.exitCode ?? null, out, res.setup?.durationMs ?? null);
      return { output: truncate(out, 6000), summary: res.error, isError: true };
    }
    const t = res.test!;
    const status = t.timedOut || t.exitCode === null ? "error" : t.exitCode === 0 ? "passed" : "failed";
    await record(status, t.command, t.exitCode, t.output, t.durationMs);
    return {
      output: `$ ${t.command}\nexit code: ${t.exitCode}${t.timedOut ? " (timed out)" : ""}\n${truncate(t.output, 7000)}`,
      summary: `${status === "passed" ? "Passed" : status === "failed" ? "Failed" : "Errored"} (exit ${t.exitCode}, ${(t.durationMs / 1000).toFixed(1)}s)`,
    };
  },
});

export const submitReport = defineTool({
  name: "submit_report",
  description:
    "Submit the final structured investigation report. Call exactly once, at the end. If you could not establish the root cause, set root_cause_found=false, give a low confidence and explain what is missing.",
  kind: "control",
  needsRepo: false,
  schema: reportSchema,
  label: () => "Submitting final report",
  async run(input, ctx) {
    ctx.state.report = input;
    return { output: "Report received.", summary: input.root_cause_found ? `Root cause identified (${input.confidence}% confidence)` : "Root cause not established" };
  },
});

export const fixTools = [proposeFix, writeTest, runTests];
