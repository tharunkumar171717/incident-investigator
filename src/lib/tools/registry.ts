import "server-only";
import { z } from "zod";
import { GitHubError } from "@/lib/github/errors";
import { UnsafePathError } from "@/lib/github/workspace";
import { fixTools, submitReport } from "./fix-tools";
import { gitTools, queryLogs, writeTools } from "./git-tools";
import { repoTools } from "./repo-tools";
import { ToolInputError, type ToolContext, type ToolDefinition, type ToolResult } from "./types";
import { TimeoutError, withTimeout } from "./util";

const ALL: ToolDefinition[] = [...repoTools, ...gitTools, queryLogs, ...fixTools, submitReport, ...writeTools] as ToolDefinition[];
const BY_NAME = new Map(ALL.map((t) => [t.name, t]));

export function getTool(name: string): ToolDefinition | undefined {
  return BY_NAME.get(name);
}

/** Tools the AI agent may call. Write tools are never included. */
export function agentTools(opts: { hasRepo: boolean }): ToolDefinition[] {
  return ALL.filter((t) => t.kind !== "write" && (opts.hasRepo || !t.needsRepo));
}

/** Read-only tools exposed by the MCP server. */
export function mcpTools(): ToolDefinition[] {
  return ALL.filter((t) => t.kind === "read" && t.name !== "query_logs");
}

export interface JsonToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export function toJsonSpec(tool: ToolDefinition): JsonToolSpec {
  const schema = z.toJSONSchema(tool.schema, { target: "draft-7", io: "input" }) as Record<string, unknown>;
  delete schema.$schema;
  return { name: tool.name, description: tool.description, input_schema: schema };
}

export interface ExecutedTool {
  tool: ToolDefinition | null;
  input: unknown;
  title: string;
  result: ToolResult;
  errorCode?: string;
}

/** Validates input and runs a tool with a timeout. Never throws. */
export async function executeTool(name: string, rawInput: unknown, ctx: ToolContext, timeoutMs: number): Promise<ExecutedTool> {
  const tool = BY_NAME.get(name);
  if (!tool) {
    return { tool: null, input: rawInput, title: `Unknown tool ${name}`, result: { output: `Unknown tool "${name}".`, summary: "Unknown tool", isError: true } };
  }
  const parsed = tool.schema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
    return { tool, input: rawInput, title: `${tool.name}: invalid input`, result: { output: `Invalid input: ${msg}`, summary: "Invalid input", isError: true } };
  }
  const title = tool.label(parsed.data);
  if (tool.needsRepo && !ctx.repo) {
    return { tool, input: parsed.data, title, result: { output: "No repository is connected to this incident.", summary: "No repository", isError: true } };
  }
  try {
    const result = await withTimeout(tool.run(parsed.data, ctx), timeoutMs, tool.name);
    return { tool, input: parsed.data, title, result };
  } catch (err) {
    let code = "tool_error";
    let message = (err as Error)?.message ?? String(err);
    if (err instanceof TimeoutError) code = "tool_timeout";
    else if (err instanceof GitHubError) code = err.code;
    else if (err instanceof ToolInputError || err instanceof UnsafePathError) code = "tool_input";
    else console.error(`[tool] ${name} failed`, err);
    if (code === "tool_error") message = `Tool failed: ${message}`;
    return { tool, input: parsed.data, title, errorCode: code, result: { output: message, summary: message.slice(0, 160), isError: true } };
  }
}
