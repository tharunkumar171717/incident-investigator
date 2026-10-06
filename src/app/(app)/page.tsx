import Link from "next/link";
import { ArrowRight, Plus, Search } from "lucide-react";
import { InvestigationBadge, SeverityBadge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardHeader, Stat } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { dashboardStats } from "@/lib/data";
import { formatDuration, formatRelative } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const SEV_COLOR: Record<string, string> = { critical: "bg-bad", high: "bg-warn", medium: "bg-info", low: "bg-subtle" };

export default async function DashboardPage() {
  const supabase = await createClient();
  const s = await dashboardStats(supabase);
  const sevTotal = s.bySeverity.reduce((a, b) => a + b.count, 0);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Incidents and AI investigations across your connected repositories."
        actions={
          <Link href="/incidents/new" className={buttonClass("primary")}>
            <Plus className="size-4" /> New incident
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total incidents" value={s.total} hint={`${s.investigations} investigation(s)`} />
        <Stat label="Open incidents" value={s.open} hint={s.running ? `${s.running} investigating now` : "none running"} tone={s.open ? "warn" : undefined} />
        <Stat label="Resolved" value={s.resolved} tone={s.resolved ? "ok" : undefined} />
        <Stat label="Critical (open)" value={s.critical} tone={s.critical ? "bad" : undefined} />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Stat label="Root-cause success rate" value={s.successRate === null ? "—" : `${s.successRate}%`} hint="root cause found / finished investigations" />
        <Stat label="Avg. investigation time" value={formatDuration(s.avgDurationMs)} hint="completed investigations" />
        <Card className="px-4 py-3.5">
          <div className="text-xs font-medium text-muted">Severity mix</div>
          {sevTotal ? (
            <>
              <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-panel-2">
                {s.bySeverity.map((b) => (b.count ? <div key={b.severity} className={SEV_COLOR[b.severity]} style={{ width: `${(b.count / sevTotal) * 100}%` }} /> : null))}
              </div>
              <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                {s.bySeverity.map((b) => (
                  <span key={b.severity} className="flex items-center gap-1.5 capitalize">
                    <span className={`size-2 rounded-sm ${SEV_COLOR[b.severity]}`} />
                    {b.severity} <span className="tabular-nums text-fg">{b.count}</span>
                  </span>
                ))}
              </div>
            </>
          ) : (
            <div className="mt-2 text-sm text-subtle">No assessed incidents yet</div>
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Recent investigations"
          actions={
            <Link href="/incidents" className="flex items-center gap-1 text-xs text-accent hover:underline">
              View all <ArrowRight className="size-3" />
            </Link>
          }
        />
        {s.recent.length === 0 ? (
          <EmptyState
            icon={<Search className="size-6" />}
            title="No investigations yet"
            description="Connect a repository, then create an incident with the error, stack trace and logs. The agent investigates the code with tools and reports the root cause."
            action={
              <div className="flex gap-2">
                <Link href="/repositories" className={buttonClass("secondary", "sm")}>
                  Connect repository
                </Link>
                <Link href="/incidents/new" className={buttonClass("primary", "sm")}>
                  New incident
                </Link>
              </div>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-4 py-2 font-medium">Incident</th>
                  <th className="px-4 py-2 font-medium">Severity</th>
                  <th className="px-4 py-2 font-medium">Result</th>
                  <th className="px-4 py-2 font-medium">Confidence</th>
                  <th className="px-4 py-2 font-medium">Duration</th>
                  <th className="px-4 py-2 font-medium">Started</th>
                </tr>
              </thead>
              <tbody>
                {s.recent.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-panel-2/60">
                    <td className="max-w-[360px] px-4 py-2.5">
                      <Link href={`/incidents/${r.incident_id}`} className="block truncate font-medium hover:text-accent">
                        {r.incidents?.title ?? "Incident"}
                      </Link>
                      {r.incidents?.endpoint && <div className="truncate font-mono text-xs text-subtle">{r.incidents.endpoint}</div>}
                    </td>
                    <td className="px-4 py-2.5">
                      <SeverityBadge severity={r.incidents?.severity} />
                    </td>
                    <td className="px-4 py-2.5">
                      <InvestigationBadge status={r.status} outcome={r.outcome} />
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">{r.root_cause_findings ? `${r.root_cause_findings.confidence}%` : "—"}</td>
                    <td className="px-4 py-2.5 tabular-nums text-muted">{formatDuration(r.duration_ms)}</td>
                    <td className="px-4 py-2.5 text-muted">{formatRelative(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
