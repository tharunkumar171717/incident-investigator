import { NextResponse } from "next/server";
import { createPullRequestForInvestigation, PullRequestError } from "@/lib/agent/pull-request";
import { handle, HttpError, parseBody, requireUser } from "@/lib/http";
import { createPullRequestSchema } from "@/lib/validation";

export const maxDuration = 120;

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/investigations/[id]/pull-request">) => {
  const { id } = await ctx.params;
  const { supabase, userId } = await requireUser();
  // confirm: true is required by the schema; the UI only sends it after the user reviewed the diff.
  const { fix_id } = await parseBody(req, createPullRequestSchema);
  const { data: fix } = await supabase.from("suggested_fixes").select("id").eq("id", fix_id).eq("investigation_id", id).maybeSingle();
  if (!fix) throw new HttpError(404, "Proposed fix not found.", "not_found");
  try {
    const pr = await createPullRequestForInvestigation({ investigationId: id, userId, fixId: fix_id, trigger: "manual" });
    return NextResponse.json(pr, { status: 201 });
  } catch (err) {
    if (err instanceof PullRequestError) throw new HttpError(err.status, err.message, err.code);
    throw err;
  }
});
