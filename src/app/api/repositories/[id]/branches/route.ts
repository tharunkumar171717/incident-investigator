import { NextResponse } from "next/server";
import { listBranches } from "@/lib/github/client";
import { handle, HttpError, requireUser } from "@/lib/http";

export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/repositories/[id]/branches">) => {
  const { id } = await ctx.params;
  const { supabase } = await requireUser();
  const { data: repo } = await supabase.from("repositories").select("owner, name, default_branch").eq("id", id).maybeSingle();
  if (!repo) throw new HttpError(404, "Repository not found.", "not_found");
  const branches = await listBranches({ owner: repo.owner, name: repo.name });
  return NextResponse.json({ default_branch: repo.default_branch, branches });
});
