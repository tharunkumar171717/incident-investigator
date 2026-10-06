import { NextResponse } from "next/server";
import { startInvestigation } from "@/lib/agent/start";
import { parseLogs } from "@/lib/agent/parse";
import { dbError, handle, HttpError, parseBody, requireUser } from "@/lib/http";
import { createIncidentSchema } from "@/lib/validation";

export const maxDuration = 300;

export const POST = handle(async (req: Request) => {
  const { supabase, userId } = await requireUser();
  const input = await parseBody(req, createIncidentSchema);

  if (input.repository_id) {
    const { data: repo } = await supabase.from("repositories").select("id").eq("id", input.repository_id).maybeSingle();
    if (!repo) throw new HttpError(422, "Selected repository was not found.", "invalid_repository");
  }

  const { data: incident, error } = await supabase
    .from("incidents")
    .insert({
      user_id: userId,
      title: input.title,
      description: input.description,
      endpoint: input.endpoint,
      error_message: input.error_message,
      stack_trace: input.stack_trace,
      additional_context: input.additional_context,
      repository_id: input.repository_id ?? null,
      branch: input.branch,
      commit_sha: input.commit_sha ?? null,
      auto_fix: input.auto_fix,
    })
    .select("id")
    .single();
  if (error || !incident) dbError(error, "create the incident");

  const lines = parseLogs(input.logs);
  for (let i = 0; i < lines.length; i += 500) {
    const { error: logError } = await supabase
      .from("incident_logs")
      .insert(lines.slice(i, i + 500).map((l) => ({ ...l, incident_id: incident.id, user_id: userId })));
    if (logError) dbError(logError, "store incident logs");
  }

  const investigationId = input.investigate ? await startInvestigation(incident.id, userId) : null;
  return NextResponse.json({ id: incident.id, investigation_id: investigationId }, { status: 201 });
});
