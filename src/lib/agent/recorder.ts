import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StepKind, StepStatus } from "@/lib/db/types";

/**
 * Persists timeline steps as they happen. The UI streams these rows, so every
 * status a user sees corresponds to a real backend action.
 */
export class StepRecorder {
  private seq: number;

  constructor(
    private db: SupabaseClient,
    private investigationId: string,
    private userId: string,
    startSeq = 0,
  ) {
    this.seq = startSeq;
  }

  static async resume(db: SupabaseClient, investigationId: string, userId: string) {
    const { data } = await db
      .from("investigation_steps")
      .select("seq")
      .eq("investigation_id", investigationId)
      .order("seq", { ascending: false })
      .limit(1)
      .maybeSingle();
    return new StepRecorder(db, investigationId, userId, data?.seq ?? 0);
  }

  async add(kind: StepKind, title: string, opts: { detail?: string | null; status?: StepStatus } = {}) {
    const now = new Date().toISOString();
    await this.insert({
      kind,
      title,
      detail: opts.detail ?? null,
      status: opts.status ?? (kind === "error" ? "error" : "success"),
      started_at: now,
      finished_at: now,
      duration_ms: 0,
    });
  }

  /** Records a running step and returns a function that completes it. */
  async start(kind: StepKind, title: string, tool?: { name: string; input: unknown }) {
    const started = Date.now();
    const id = await this.insert({
      kind,
      title,
      status: "running",
      tool_name: tool?.name ?? null,
      tool_input: (tool?.input as Record<string, unknown>) ?? null,
      started_at: new Date(started).toISOString(),
    });
    return async (status: StepStatus, opts: { detail?: string | null; output?: string | null; title?: string } = {}) => {
      if (id === null) return;
      const { error } = await this.db
        .from("investigation_steps")
        .update({
          status,
          detail: opts.detail ?? null,
          tool_output: opts.output ?? null,
          ...(opts.title ? { title: opts.title } : {}),
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - started,
        })
        .eq("id", id);
      if (error) console.error("[recorder] update failed", error);
    };
  }

  private async insert(row: Record<string, unknown>): Promise<number | null> {
    const seq = ++this.seq;
    const { data, error } = await this.db
      .from("investigation_steps")
      .insert({ ...row, seq, investigation_id: this.investigationId, user_id: this.userId })
      .select("id")
      .single();
    if (error) {
      console.error("[recorder] insert failed", error);
      return null;
    }
    return data.id as number;
  }
}
