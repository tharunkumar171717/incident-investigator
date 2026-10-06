import { NextResponse } from "next/server";
import { getIncidentBundle } from "@/lib/data";
import { dbError, handle, HttpError, parseBody, requireUser } from "@/lib/http";
import { updateIncidentSchema } from "@/lib/validation";

export const GET = handle(async (req: Request, ctx: RouteContext<"/api/incidents/[id]">) => {
  const { id } = await ctx.params;
  const { supabase } = await requireUser();
  const investigation = new URL(req.url).searchParams.get("investigation");
  const bundle = await getIncidentBundle(supabase, id, investigation);
  if (!bundle) throw new HttpError(404, "Incident not found.", "not_found");
  return NextResponse.json(bundle);
});

export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/incidents/[id]">) => {
  const { id } = await ctx.params;
  const { supabase } = await requireUser();
  const { status } = await parseBody(req, updateIncidentSchema);
  const { data, error } = await supabase
    .from("incidents")
    .update({ status, resolved_at: status === "resolved" || status === "closed" ? new Date().toISOString() : null })
    .eq("id", id)
    .select("id, status")
    .maybeSingle();
  if (error) dbError(error, "update the incident");
  if (!data) throw new HttpError(404, "Incident not found.", "not_found");
  return NextResponse.json(data);
});

export const DELETE = handle(async (_req: Request, ctx: RouteContext<"/api/incidents/[id]">) => {
  const { id } = await ctx.params;
  const { supabase } = await requireUser();
  const { data: running } = await supabase.from("investigations").select("id").eq("incident_id", id).in("status", ["queued", "running"]);
  if (running?.length) throw new HttpError(409, "Cancel the running investigation first.", "already_running");
  const { error, count } = await supabase.from("incidents").delete({ count: "exact" }).eq("id", id);
  if (error) dbError(error, "delete the incident");
  if (!count) throw new HttpError(404, "Incident not found.", "not_found");
  return new NextResponse(null, { status: 204 });
});
