import "server-only";
import { env } from "@/lib/env";
import { AnthropicProvider } from "./anthropic";
import { GeminiProvider } from "./gemini";
import { ProviderError, type LLMProvider } from "./types";

/** Selects the configured AI provider. Add new adapters here. */
export function getProvider(): LLMProvider {
  const e = env();
  switch (e.AI_PROVIDER) {
    case "gemini":
      if (!e.GEMINI_API_KEY) throw new ProviderError("ai_not_configured", "AI_PROVIDER=gemini but GEMINI_API_KEY is not set.");
      return new GeminiProvider(e.GEMINI_API_KEY, e.GEMINI_MODEL);
    case "anthropic":
    default:
      return new AnthropicProvider(e.ANTHROPIC_API_KEY, e.ANTHROPIC_MODEL, e.ANTHROPIC_EFFORT);
  }
}

export { ProviderError } from "./types";
export type { LLMProvider } from "./types";
