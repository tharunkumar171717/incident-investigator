import type { JsonToolSpec } from "@/lib/tools/registry";

// Provider-neutral agent interface. Each adapter keeps its own native message
// history (so provider-specific blocks such as thinking signatures round-trip
// unchanged); the runner only sees turns, tool calls and usage.

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultMessage {
  id: string;
  name: string;
  output: string;
  isError: boolean;
}

export interface AgentTurn {
  text: string;
  thoughts: string[];
  toolCalls: ToolCall[];
  stop: "tool_use" | "end_turn" | "max_tokens" | "other";
  usage: { inputTokens: number; outputTokens: number };
}

export interface AgentSession {
  /** First call: pass `userText`. Later calls: tool results and optional operator note. */
  next(input: { userText?: string; toolResults?: ToolResultMessage[]; signal: AbortSignal }): Promise<AgentTurn>;
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  startSession(opts: { system: string; tools: JsonToolSpec[] }): AgentSession;
}

export type ProviderErrorCode = "ai_not_configured" | "ai_auth" | "ai_rate_limited" | "ai_unavailable" | "ai_bad_request" | "ai_refusal" | "ai_context";

export class ProviderError extends Error {
  constructor(
    public code: ProviderErrorCode,
    message: string,
    public retryable = false,
  ) {
    super(message);
  }
}
