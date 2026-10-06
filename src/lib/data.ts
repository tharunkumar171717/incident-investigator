import "server-only";
import type { ServerSupabase } from "@/lib/supabase/server";
import type {
  IncidentRow,
  InvestigationRow,
  InvestigationStepRow,
  PullRequestRow,
  RepositoryRow,
  RootCauseFindingRow,
  SuggestedFixRow,
  TestResultRow,
} from "@/lib/db/types";
import type { HistoryFilters } from "@/lib/validation";

export interface IncidentBundle {
  incident: IncidentRow;
  repository: RepositoryRow | null;
  investigations: InvestigationRow[];
  investigation: InvestigationRow | null;
  steps: InvestigationStepRow[];
  finding: RootCauseFindingRow | null;
  fix: SuggestedFixRow | null;
  tests: TestResultRow[];
  pullRequests: PullRequestRow[];
  logCount: number;
}

/** Everything the incident page needs. Runs as the signed-in user (RLS). */
export async function getIncidentBundle(supabase: ServerSupabase, id: string, investigationId?: string | null): Promise<IncidentBundle | null> {
  const { data: incident } = await supabase.from("incidents").select("*").eq("id", id).maybeSingle<IncidentRow>();
  if (!incident) return null;
  const [{ data: investigations }, { data: repository }, { count }] = await Promise.all([
    supabase.from("investigations").select("*").eq("incident_id", id).order("created_at", { ascending: false }).returns<InvestigationRow[]>(),
    incident.repository_id
      ? supabase.from("repositories").select("*").eq("id", incident.repository_id).maybeSingle<RepositoryRow>()
      : Promise.resolve({ data: null }),
    supabase.from("incident_logs").select("id", { count: "exact", head: true }).eq("incident_id", id),
  ]);
  const investigation = (investigationId ? investigations?.find((i) => i.id === investigationId) : investigations?.[0]) ?? null;

  let steps: InvestigationStepRow[] = [];
  let finding: RootCauseFindingRow | null = null;
  let fix: SuggestedFixRow | null = null;
  let tests: TestResultRow[] = [];
  let pullRequests: PullRequestRow[] = [];
  if (investigation) {
    const [s, f, fx, t, p] = await Promise.all([
      supabase.from("investigation_steps").select("*").eq("investigation_id", investigation.id).order("seq").returns<InvestigationStepRow[]>(),
      supabase.from("root_cause_findings").select("*").eq("investigation_id", investigation.id).maybeSingle<RootCauseFindingRow>(),
      supabase.from("suggested_fixes").select("*").eq("investigation_id", investigation.id).order("created_at", { ascending: false }).limit(1).returns<SuggestedFixRow[]>(),
      supabase.from("test_results").select("*").eq("investigation_id", investigation.id).order("created_at").returns<TestResultRow[]>(),
      supabase.from("pull_requests").select("*").eq("investigation_id", investigation.id).order("created_at", { ascending: false }).returns<PullRequestRow[]>(),
    ]);
    steps = s.data ?? [];
    finding = f.data ?? null;
    fix = fx.data?.[0] ?? null;
    tests = t.data ?? [];
    pullRequests = p.data ?? [];
  }
  return {
    incident,
    repository: repository ?? null,
    investigations: investigations ?? [],
    investigation,
    steps,
    finding,
    fix,
    tests,
    pullRequests,
    logCount: count ?? 0,
  };
}

export type IncidentListItem = IncidentRow & {
  repositories: Pick<RepositoryRow, "full_name"> | null;
  investigations: Pick<InvestigationRow, "id" | "status" | "outcome" | "duration_ms" | "created_at">[];
};

export const PAGE_SIZE = 25;

export async function listIncidents(supabase: ServerSupabase, f: HistoryFilters) {
  // !inner on investigations is only needed when filtering by result.
  const invJoin = f.result && f.result !== "none" ? "investigations!inner" : "investigations";
  let q = supabase
    .from("incidents")
    .select(`*, repositories(full_name), ${invJoin}(id, status, outcome, duration_ms, created_at)`, { count: "exact" })
    .order("created_at", { ascending: false })
    .order("created_at", { referencedTable: "investigations", ascending: false });
  if (f.severity) q = q.eq("severity", f.severity);
  if (f.status) q = q.eq("status", f.status);
  if (f.repository) q = q.eq("repository_id", f.repository);
  if (f.from) q = q.gte("created_at", `${f.from}T00:00:00Z`);
  if (f.to) q = q.lte("created_at", `${f.to}T23:59:59Z`);
  if (f.q) q = q.ilike("title", `%${f.q.replace(/[%_]/g, "\\$&")}%`);
  if (f.result && f.result !== "none") q = q.eq("investigations.outcome", f.result);
  const page = f.page ?? 1;
  q = q.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const { data, count, error } = await q.returns<IncidentListItem[]>();
  if (error) throw new Error(error.message);
  let rows = data ?? [];
  if (f.result === "none") rows = rows.filter((r) => r.investigations.length === 0);
  return { rows, count: count ?? 0, page };
}

export async function dashboardStats(supabase: ServerSupabase) {
  const [incidents, investigations, recent] = await Promise.all([
    supabase.from("incidents").select("status, severity").returns<Pick<IncidentRow, "status" | "severity">[]>(),
    supabase.from("investigations").select("status, outcome, duration_ms").returns<Pick<InvestigationRow, "status" | "outcome" | "duration_ms">[]>(),
    supabase
      .from("investigations")
      .select("id, status, outcome, duration_ms, created_at, incident_id, incidents(title, severity, endpoint), root_cause_findings(confidence, summary)")
      .order("created_at", { ascending: false })
      .limit(8),
  ]);
  if (incidents.error) throw new Error(incidents.error.message);
  const inc = incidents.data ?? [];
  const inv = investigations.data ?? [];
  const finished = inv.filter((i) => i.status === "completed" || i.status === "failed");
  const found = inv.filter((i) => i.outcome === "root_cause_found").length;
  const durations = inv.filter((i) => i.status === "completed" && i.duration_ms).map((i) => i.duration_ms!);
  return {
    total: inc.length,
    open: inc.filter((i) => !["resolved", "closed"].includes(i.status)).length,
    resolved: inc.filter((i) => i.status === "resolved" || i.status === "closed").length,
    critical: inc.filter((i) => i.severity === "critical" && !["resolved", "closed"].includes(i.status)).length,
    bySeverity: (["critical", "high", "medium", "low"] as const).map((s) => ({ severity: s, count: inc.filter((i) => i.severity === s).length })),
    investigations: inv.length,
    running: inv.filter((i) => i.status === "running" || i.status === "queued").length,
    successRate: finished.length ? Math.round((found / finished.length) * 100) : null,
    avgDurationMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    recent: (recent.data ?? []) as unknown as RecentInvestigation[],
  };
}

export interface RecentInvestigation {
  id: string;
  status: InvestigationRow["status"];
  outcome: InvestigationRow["outcome"];
  duration_ms: number | null;
  created_at: string;
  incident_id: string;
  incidents: Pick<IncidentRow, "title" | "severity" | "endpoint"> | null;
  root_cause_findings: { confidence: number; summary: string } | null;
}

export async function listRepositories(supabase: ServerSupabase) {
  const { data, error } = await supabase.from("repositories").select("*").order("created_at", { ascending: false }).returns<RepositoryRow[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}
