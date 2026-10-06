import { NextResponse } from "next/server";
import { abortLocal } from "@/lib/agent/runner";
import { handle, HttpError, requireUser } from "@/lib/http";
import { adminClient } from "@/lib/supabase/admin";

export const POST = handle(async (_req: Request, ctx: RouteContext<"/api/investigations/[id]/cancel">) => {
  const { id } = await ctx.params;
  const { supabase } = await requireUser();
  const { data: inv } = await supabase.from("investigations").select("id, status, user_id").eq("id", id).maybeSingle();
  if (!inv) throw new HttpError(404, "Investigation not found.", "not_found");
  if (inv.status !== "running" && inv.status !== "queued") throw new HttpError(409, "The investigation is not running.", "not_running");
  // Users cannot write investigations directly (RLS); flag it with the service client after the ownership check above.
  await adminClient().from("investigations").update({ cancel_requested: true }).eq("id", id).eq("user_id", inv.user_id);
  abortLocal(id);
  return NextResponse.json({ ok: true });
});
