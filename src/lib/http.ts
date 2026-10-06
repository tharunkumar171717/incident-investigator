import "server-only";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { createClient, type ServerSupabase } from "@/lib/supabase/server";
import { ConfigError } from "@/lib/env";
import { GitHubError } from "@/lib/github/errors";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "error",
  ) {
    super(message);
  }
}

export function jsonError(status: number, message: string, code = "error") {
  return NextResponse.json({ error: { message, code } }, { status });
}

/** Wraps a route handler with consistent error responses. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof HttpError) return jsonError(err.status, err.message, err.code);
      if (err instanceof GitHubError) return jsonError(err.status >= 500 ? 502 : err.status, err.message, err.code);
      if (err instanceof ConfigError) return jsonError(500, err.message, err.code);
      console.error("[api] unhandled error", err);
      return jsonError(500, "Unexpected server error. Check the server logs.", "internal");
    }
  };
}

export async function requireUser(): Promise<{ supabase: ServerSupabase; userId: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || !userId) throw new HttpError(401, "Sign in to continue.", "unauthorized");
  return { supabase, userId };
}

export async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "Request body must be JSON.", "invalid_json");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    throw new HttpError(422, msg, "validation_error");
  }
  return parsed.data;
}

export function dbError(err: { message: string; code?: string } | null, what: string): never {
  console.error(`[db] ${what}`, err);
  if (err?.code === "42P01") {
    throw new HttpError(500, "Database tables are missing. Run `npm run db:migrate` first.", "schema_missing");
  }
  throw new HttpError(500, `Could not ${what}.`, "db_error");
}
