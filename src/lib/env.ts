import "server-only";
import { z } from "zod";

const bool = (fallback: boolean) =>
  z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === "true" || v === "1"));

const int = (fallback: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).optional().transform((v) => v ?? fallback);

// Server-only configuration. Variable names match the existing Supabase setup in
// ../live-location-tracker/server/.env so values can be copied across unchanged.
const schema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  SUPABASE_SECRET_KEY: z.string().min(20),
  APP_URL: z.url().optional(),

  AI_PROVIDER: z.enum(["anthropic", "gemini"]).default("anthropic"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-opus-5-5"),
  ANTHROPIC_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("high"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-2.5-pro"),

  GITHUB_TOKEN: z.string().optional(),
  GITHUB_WRITE_TOKEN: z.string().optional(),
  GITHUB_ALLOWED_OWNERS: z.string().optional(),

  ENABLE_TEST_EXECUTION: bool(false),
  TEST_TIMEOUT_SECONDS: int(120, 10, 900),

  AGENT_MAX_STEPS: int(30, 3, 100),
  AGENT_MAX_TOOL_CALLS: int(60, 3, 200),
  AGENT_MAX_TOKENS: int(1_500_000, 50_000, 10_000_000),
  AGENT_MAX_DURATION_SECONDS: int(600, 60, 3600),
  TOOL_TIMEOUT_SECONDS: int(45, 5, 300),
  MAX_REPO_ARCHIVE_MB: int(150, 5, 2000),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | null = null;

export class ConfigError extends Error {
  code = "config_error" as const;
}

export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new ConfigError(`Invalid server environment - ${issues}. See .env.example.`);
  }
  cached = parsed.data;
  return cached;
}

export function allowedOwners(): string[] | null {
  const raw = env().GITHUB_ALLOWED_OWNERS;
  if (!raw) return null;
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}
