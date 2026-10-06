import { NextResponse } from "next/server";
import { splitCommand } from "@/lib/tools/test-runner";
import { dbError, handle, HttpError, parseBody, requireUser } from "@/lib/http";
import { updateRepositorySchema } from "@/lib/validation";

export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/repositories/[id]">) => {
  const { id } = await ctx.params;
  const { supabase } = await requireUser();
  const input = await parseBody(req, updateRepositorySchema);
  for (const [field, cmd] of [["test_command", input.test_command], ["setup_command", input.setup_command]] as const) {
    if (cmd) {
      try {
        splitCommand(cmd);
      } catch (e) {
        throw new HttpError(422, `${field}: ${(e as Error).message}`, "validation_error");
      }
    }
  }
  const { data, error } = await supabase.from("repositories").update(input).eq("id", id).select("*").maybeSingle();
  if (error) dbError(error, "update the repository");
  if (!data) throw new HttpError(404, "Repository not found.", "not_found");
  return NextResponse.json(data);
});

export const DELETE = handle(async (_req: Request, ctx: RouteContext<"/api/repositories/[id]">) => {
  const { id } = await ctx.params;
  const { supabase } = await requireUser();
  const { error, count } = await supabase.from("repositories").delete({ count: "exact" }).eq("id", id);
  if (error) dbError(error, "remove the repository");
  if (!count) throw new HttpError(404, "Repository not found.", "not_found");
  return new NextResponse(null, { status: 204 });
});
