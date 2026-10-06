import type { InvestigationStepRow } from "@/lib/db/types";
import { failStaleInvestigations } from "@/lib/agent/runner";
import { handle, HttpError, requireUser } from "@/lib/http";
import { adminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

/**
 * Server-Sent Events stream of an investigation's progress. Reads the rows the
 * runner persists (as the signed-in user, so RLS applies) and pushes new and
 * updated steps plus status changes until the investigation finishes.
 */
export const GET = handle(async (req: Request, ctx: RouteContext<"/api/investigations/[id]/stream">) => {
  const { id } = await ctx.params;
  const { supabase, userId } = await requireUser();
  const { data: first } = await supabase.from("investigations").select("id").eq("id", id).maybeSingle();
  if (!first) throw new HttpError(404, "Investigation not found.", "not_found");

  const encoder = new TextEncoder();
  let closed = false;
  req.signal.addEventListener("abort", () => {
    closed = true;
  });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown, id?: number) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const versions = new Map<number, string>();
      let lastStatus = "";
      let ticks = 0;
      const deadline = Date.now() + 15 * 60 * 1000;
      try {
        while (!closed && Date.now() < deadline) {
          const [{ data: inv }, { data: steps }] = await Promise.all([
            supabase
              .from("investigations")
              .select("id, status, outcome, error, error_code, step_count, tool_call_count, input_tokens, output_tokens, started_at, completed_at, duration_ms")
              .eq("id", id)
              .single(),
            supabase.from("investigation_steps").select("*").eq("investigation_id", id).order("seq").returns<InvestigationStepRow[]>(),
          ]);
          if (!inv) break;
          for (const s of steps ?? []) {
            const v = `${s.status}:${s.finished_at}:${s.title}`;
            if (versions.get(s.id) !== v) {
              versions.set(s.id, v);
              send("step", s, s.seq);
            }
          }
          const statusKey = `${inv.status}:${inv.step_count}:${inv.tool_call_count}`;
          if (statusKey !== lastStatus) {
            lastStatus = statusKey;
            send("status", inv);
          }
          if (["completed", "failed", "cancelled"].includes(inv.status)) {
            send("done", { status: inv.status });
            break;
          }
          if (++ticks % 30 === 0) {
            send("ping", {});
            await failStaleInvestigations(adminClient(), userId);
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
      } catch (err) {
        send("error", { message: (err as Error).message });
      } finally {
        if (!closed) controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
