import { z } from "zod";

const optText = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v?.trim() ? v.trim() : null));

export const createIncidentSchema = z.object({
  title: z.string().trim().min(3, "Title must be at least 3 characters").max(200),
  description: optText(10_000),
  endpoint: optText(500),
  error_message: optText(5_000),
  stack_trace: optText(50_000),
  logs: optText(500_000),
  additional_context: optText(10_000),
  repository_id: z.uuid().optional().nullable(),
  branch: optText(200),
  commit_sha: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{7,40}$/i, "Commit must be a 7-40 character hex SHA")
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  auto_fix: z.boolean().optional().default(false),
  investigate: z.boolean().optional().default(true),
});
export type CreateIncidentInput = z.infer<typeof createIncidentSchema>;

export const updateIncidentSchema = z.object({
  status: z.enum(["open", "resolved", "closed"]),
});

export const connectRepositorySchema = z.object({
  repository: z.string().trim().min(3).max(200).describe("owner/name or GitHub URL"),
});

export const updateRepositorySchema = z.object({
  default_branch: z.string().trim().min(1).max(200).optional(),
  test_command: optText(300),
  setup_command: optText(300),
});

export const createPullRequestSchema = z.object({
  fix_id: z.uuid(),
  confirm: z.literal(true, { error: "Confirmation is required to modify the repository." }),
});

export const historyFilterSchema = z.object({
  severity: z.enum(["critical", "high", "medium", "low"]).optional().catch(undefined),
  status: z.enum(["open", "investigating", "root_cause_identified", "fix_proposed", "resolved", "closed"]).optional().catch(undefined),
  repository: z.uuid().optional().catch(undefined),
  result: z.enum(["root_cause_found", "inconclusive", "error", "none"]).optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  q: z.string().max(200).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(1000).optional().catch(undefined),
});
export type HistoryFilters = z.infer<typeof historyFilterSchema>;
