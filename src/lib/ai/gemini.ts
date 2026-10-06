import "server-only";
import { ApiError, GoogleGenAI, type Content, type FunctionDeclaration, type Part } from "@google/genai";
import type { JsonToolSpec } from "@/lib/tools/registry";
import { ProviderError, type AgentSession, type AgentTurn, type LLMProvider } from "./types";

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";
  private ai: GoogleGenAI;

  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  startSession({ system, tools }: { system: string; tools: JsonToolSpec[] }): AgentSession {
    const contents: Content[] = [];
    const functionDeclarations: FunctionDeclaration[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      parametersJsonSchema: t.input_schema,
    }));
    let callSeq = 0;

    return {
      next: async ({ userText, toolResults, signal }) => {
        const parts: Part[] = [];
        for (const r of toolResults ?? []) {
          parts.push({ functionResponse: { id: r.id, name: r.name, response: r.isError ? { error: r.output } : { output: r.output } } });
        }
        if (userText) parts.push({ text: userText });
        contents.push({ role: "user", parts });

        let res;
        try {
          res = await this.ai.models.generateContent({
            model: this.model,
            contents,
            config: {
              systemInstruction: system,
              tools: [{ functionDeclarations }],
              thinkingConfig: { includeThoughts: true },
              abortSignal: signal,
            },
          });
        } catch (err) {
          throw mapError(err);
        }

        const candidate = res.candidates?.[0];
        if (!candidate?.content) {
          throw new ProviderError("ai_refusal", `Gemini returned no content (${candidate?.finishReason ?? res.promptFeedback?.blockReason ?? "unknown"}).`);
        }
        contents.push(candidate.content);

        const turn: AgentTurn = {
          text: "",
          thoughts: [],
          toolCalls: [],
          stop: "end_turn",
          usage: { inputTokens: res.usageMetadata?.promptTokenCount ?? 0, outputTokens: (res.usageMetadata?.candidatesTokenCount ?? 0) + (res.usageMetadata?.thoughtsTokenCount ?? 0) },
        };
        for (const part of candidate.content.parts ?? []) {
          if (part.thought && part.text) turn.thoughts.push(part.text.trim());
          else if (part.text) turn.text += part.text;
          else if (part.functionCall?.name) {
            turn.toolCalls.push({ id: part.functionCall.id ?? `call_${++callSeq}`, name: part.functionCall.name, input: part.functionCall.args ?? {} });
          }
        }
        if (turn.toolCalls.length) turn.stop = "tool_use";
        else if (candidate.finishReason === "MAX_TOKENS") turn.stop = "max_tokens";
        return turn;
      },
    };
  }
}

function mapError(err: unknown): ProviderError {
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 403) return new ProviderError("ai_auth", "Gemini rejected the API key. Check GEMINI_API_KEY.");
    if (err.status === 429) return new ProviderError("ai_rate_limited", "Gemini is rate limiting requests. Retry in a minute.", true);
    if (err.status === 400 || err.status === 404) return new ProviderError("ai_bad_request", `Gemini rejected the request: ${err.message}`);
    return new ProviderError("ai_unavailable", `Gemini returned an error (${err.status}). Retry shortly.`, true);
  }
  return new ProviderError("ai_unavailable", `Could not reach Gemini: ${(err as Error)?.message ?? String(err)}`, true);
}
