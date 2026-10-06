import { z } from "zod";

// The structured result every investigation must produce. The agent submits it
// through the submit_report tool; the server validates it with this schema and
// then attaches real code snippets for each code reference.
export const reportSchema = z.object({
  root_cause_found: z
    .boolean()
    .describe("true only if the root cause is supported by concrete evidence gathered with tools"),
  summary: z.string().min(1).describe("2-4 sentence summary of the incident and conclusion"),
  severity: z.enum(["critical", "high", "medium", "low"]),
  confidence: z.number().int().min(0).max(100).describe("0-100; lower it when evidence is indirect"),
  affected_service: z.string().describe("service/module name, or 'unknown'"),
  affected_endpoint: z.string().describe("e.g. 'POST /api/orders', or 'unknown'"),
  root_cause: z.string().min(1).describe("precise technical explanation, citing file:line"),
  evidence: z
    .array(
      z.object({
        type: z.enum(["stack_trace", "log", "code", "commit", "endpoint", "other"]),
        description: z.string().min(1),
        source: z.string().describe("where it came from, e.g. 'src/orders.py:142', 'log line 17', 'commit abc123'"),
      }),
    )
    .describe("each item must come from a tool result or the incident input"),
  affected_files: z.array(z.string()),
  call_chain: z.array(z.string()).describe("ordered, entry point first, e.g. 'POST /orders -> create_order() (orders.py:40)'"),
  code_references: z
    .array(
      z.object({
        path: z.string(),
        start_line: z.number().int().min(1),
        end_line: z.number().int().min(1),
        highlight_lines: z.array(z.number().int().min(1)),
        explanation: z.string().describe("why this code is related to the incident"),
      }),
    )
    .max(8)
    .describe("the most relevant code regions you actually read; keep each region under 40 lines"),
  suggested_fix: z.string().describe("what to change and why; reference the propose_fix change if one was made"),
  tests_to_add: z.array(z.string()),
  risk: z.string().describe("risk of the fix / of leaving it unfixed"),
  recommended_action: z.string(),
});

export type ReportInput = z.infer<typeof reportSchema>;
