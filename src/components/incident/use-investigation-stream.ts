"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { InvestigationRow, InvestigationStepRow } from "@/lib/db/types";

type StatusEvent = Pick<
  InvestigationRow,
  "id" | "status" | "outcome" | "error" | "error_code" | "step_count" | "tool_call_count" | "input_tokens" | "output_tokens" | "started_at" | "completed_at" | "duration_ms"
>;

/** Subscribes to the SSE progress stream while an investigation is active. */
export function useInvestigationStream(
  investigationId: string | null,
  active: boolean,
  handlers: { onStep: (s: InvestigationStepRow) => void; onStatus: (s: StatusEvent) => void; onDone: () => void; onError?: (msg: string) => void },
) {
  const ref = useRef(handlers);
  useLayoutEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    if (!investigationId || !active) return;
    const es = new EventSource(`/api/investigations/${investigationId}/stream`);
    let finished = false;
    es.addEventListener("step", (e) => ref.current.onStep(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("status", (e) => ref.current.onStatus(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("done", () => {
      finished = true;
      es.close();
      ref.current.onDone();
    });
    es.addEventListener("error", (e) => {
      const data = (e as MessageEvent).data;
      if (data) ref.current.onError?.(JSON.parse(data).message);
      // EventSource reconnects automatically on network errors; when the
      // server closes the stream after "done" we stop here.
      if (finished) es.close();
    });
    return () => es.close();
  }, [investigationId, active]);
}
