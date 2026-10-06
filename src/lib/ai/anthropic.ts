import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { JsonToolSpec } from "@/lib/tools/registry";
import { ProviderError, type AgentSession, type AgentTurn, type LLMProvider } from "./types";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(
    apiKey: string | undefined,
    readonly model: string,
    private effort: Effort,
  ) {
    // With no key the SDK falls back to ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile.
    this.client = new Anthropic({ apiKey: apiKey || undefined, maxRetries: 3, timeout: 10 * 60 * 1000 });
  }

  startSession({ system, tools }: { system: string; tools: JsonToolSpec[] }): AgentSession {
    const messages: Anthropic.Beta.BetaMessageParam[] = [];
    const toolDefs: Anthropic.Beta.BetaTool[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Beta.BetaTool.InputSchema,
      // Large inputs (proposed fixes, test files) stream as generated. The
      // runner validates every input with zod before executing it.
      eager_input_streaming: true,
    }));

    return {
      next: async ({ userText, toolResults, signal }) => {
        const content: Anthropic.Beta.BetaContentBlockParam[] = [];
        for (const r of toolResults ?? []) {
          content.push({ type: "tool_result", tool_use_id: r.id, content: r.output, is_error: r.isError || undefined });
        }
        if (userText) content.push({ type: "text", text: userText });
        messages.push({ role: "user", content });

        let jsonRetries = 0;
        for (;;) {
          let message: Anthropic.Beta.BetaMessage;
          try {
            const stream = this.client.beta.messages.stream(
              {
                model: this.model,
                max_tokens: 32000,
                system,
                tools: toolDefs,
                messages,
                thinking: { type: "adaptive", display: "summarized" },
                output_config: { effort: this.effort },
                cache_control: { type: "ephemeral" },
                // Server-side refusal fallback: a policy decline is re-run on a
                // fallback model inside the same call instead of failing the run.
                betas: ["server-side-fallback-2026-07-01"],
                fallbacks: "default",
              },
              { signal },
            );
            message = await stream.finalMessage();
            jsonRetries = 0;
          } catch (err) {
            if (!(err instanceof Anthropic.APIError) && !signal.aborted && !(err instanceof Anthropic.APIUserAbortError) && jsonRetries++ < 2) {
              continue; // tool input was not parseable JSON; re-issue the turn
            }
            throw mapError(err);
          }

          if (message.stop_reason === "pause_turn") {
            messages.push({ role: "assistant", content: message.content });
            continue;
          }
          if (message.stop_reason === "refusal") {
            throw new ProviderError("ai_refusal", "The model declined to continue this investigation.");
          }
          if (message.stop_reason === "model_context_window_exceeded") {
            throw new ProviderError("ai_context", "The investigation exceeded the model's context window.");
          }

          // Append the full content (thinking blocks included) unchanged.
          messages.push({ role: "assistant", content: message.content });

          const turn: AgentTurn = {
            text: "",
            thoughts: [],
            toolCalls: [],
            stop: message.stop_reason === "tool_use" ? "tool_use" : message.stop_reason === "end_turn" ? "end_turn" : message.stop_reason === "max_tokens" ? "max_tokens" : "other",
            usage: {
              inputTokens:
                message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0),
              outputTokens: message.usage.output_tokens,
            },
          };
          for (const block of message.content) {
            if (block.type === "text") turn.text += block.text;
            else if (block.type === "thinking" && block.thinking.trim()) turn.thoughts.push(block.thinking.trim());
            else if (block.type === "tool_use") turn.toolCalls.push({ id: block.id, name: block.name, input: block.input });
          }
          // A tool input cut off at max_tokens is still returned (every tool_use
          // needs a tool_result next turn) but the runner will not execute it.
          return turn;
        }
      },
    };
  }
}

function mapError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err instanceof Anthropic.APIUserAbortError) return new ProviderError("ai_unavailable", "Cancelled.");
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new ProviderError("ai_auth", "The AI provider rejected the API key. Check ANTHROPIC_API_KEY.");
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new ProviderError("ai_rate_limited", "The AI provider is rate limiting requests. Retry in a minute.", true);
  }
  if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.NotFoundError) {
    return new ProviderError("ai_bad_request", `The AI provider rejected the request: ${err.message}`);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new ProviderError("ai_unavailable", "Could not reach the AI provider (network error or timeout).", true);
  }
  if (err instanceof Anthropic.APIError) {
    return new ProviderError("ai_unavailable", `The AI provider returned an error (${err.status ?? "unknown"}). Retry shortly.`, true);
  }
  return new ProviderError("ai_unavailable", `AI provider failure: ${(err as Error)?.message ?? String(err)}`, true);
}
