import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

let admin: SupabaseClient | null = null;

/**
 * Service client using the server-only secret key. It bypasses RLS, so it is
 * only used by the background investigation runner, which always scopes its
 * reads and writes by the user_id of the investigation it is running.
 */
export function adminClient(): SupabaseClient {
  if (admin) return admin;
  const { SUPABASE_URL, SUPABASE_SECRET_KEY } = env();
  admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return admin;
}
