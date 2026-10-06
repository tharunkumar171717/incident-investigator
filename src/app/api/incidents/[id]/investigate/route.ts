import { NextResponse } from "next/server";
import { startInvestigation } from "@/lib/agent/start";
import { handle, requireUser } from "@/lib/http";

export const maxDuration = 800;

export const POST = handle(async (_req: Request, ctx: RouteContext<"/api/incidents/[id]/investigate">) => {
  const { id } = await ctx.params;
  const { userId } = await requireUser();
  const investigationId = await startInvestigation(id, userId);
  return NextResponse.json({ investigation_id: investigationId }, { status: 202 });
});
