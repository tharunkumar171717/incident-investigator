import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { FileChange, IncidentRow, RepositoryRow, TestResultRow } from "@/lib/db/types";
import type { RepoRef } from "@/lib/github/client";
import type { Workspace } from "@/lib/github/workspace";
import type { ReportInput } from "@/lib/agent/report-schema";

export interface InvestigationState {
  fixId: string | null;
  fixDescription: string | null;
  changes: FileChange[];
  lastTest: Pick<TestResultRow, "status" | "command" | "exit_code"> | null;
  report: ReportInput | null;
}

export interface ToolContext {
  userId: string;
  investigationId: string | null; // null when used from the MCP server
  incident: IncidentRow | null;
  repository: RepositoryRow | null;
  repo: RepoRef | null;
  ref: string | null;
  sha: string | null;
  workspace: () => Promise<Workspace>;
  db: SupabaseClient | null;
  state: InvestigationState;
  signal: AbortSignal;
}

export interface ToolResult {
  /** Text returned to the model. Keep it compact. */
  output: string;
  /** Short human summary shown in the timeline. */
  summary: string;
  isError?: boolean;
}

/**
 * read    - inspects code, history or logs; always available to the agent
 * propose - records proposed changes / runs tests in a sandbox copy; never touches GitHub
 * write   - modifies the remote repository; never exposed to the agent, only run
 *           after explicit user confirmation (or the incident's auto-fix opt-in)
 * control - ends the investigation
 */
export type ToolKind = "read" | "propose" | "write" | "control";

export interface ToolDefinition<S extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  kind: ToolKind;
  needsRepo: boolean;
  schema: S;
  /** Human-readable timeline title, e.g. "Reading src/orders.py". */
  label: (input: z.infer<S>) => string;
  run: (input: z.infer<S>, ctx: ToolContext) => Promise<ToolResult>;
}

export function defineTool<S extends z.ZodObject>(def: ToolDefinition<S>): ToolDefinition<S> {
  return def;
}

export class ToolInputError extends Error {}
