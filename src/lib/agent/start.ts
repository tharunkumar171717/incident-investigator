import "server-only";
import { after } from "next/server";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { adminClient } from "@/lib/supabase/admin";
import { failStaleInvestigations, runInvestigation } from "./runner";

/** Creates a queued investigation for an incident the caller owns and runs it in the background. */
export async function startInvestigation(incidentId: string, userId: string): Promise<string> {
  const db = adminClient();
  await failStaleInvestigations(db, userId);

  const { data: incident } = await db.from("incidents").select("id, repository_id").eq("id", incidentId).eq("user_id", userId).single();
  if (!incident) throw new HttpError(404, "Incident not found.", "not_found");

  const { data: activeRuns } = await db.from("investigations").select("id").eq("incident_id", incidentId).in("status", ["queued", "running"]);
  if (activeRuns?.length) throw new HttpError(409, "An investigation is already running for this incident.", "already_running");

  const e = env();
  if (e.AI_PROVIDER === "gemini" && !e.GEMINI_API_KEY) throw new HttpError(500, "GEMINI_API_KEY is not configured on the server.", "ai_not_configured");

  const { data: inv, error } = await db
    .from("investigations")
    .insert({
      incident_id: incidentId,
      user_id: userId,
      repository_id: incident.repository_id,
      status: "queued",
      provider: e.AI_PROVIDER,
      model: e.AI_PROVIDER === "gemini" ? e.GEMINI_MODEL : e.ANTHROPIC_MODEL,
    })
    .select("id")
    .single();
  if (error || !inv) throw new HttpError(500, "Could not create the investigation.", "db_error");

  // Runs after the response is sent; progress is persisted step by step and
  // streamed to the browser from the database.
  after(() => runInvestigation(inv.id));
  return inv.id;
}
