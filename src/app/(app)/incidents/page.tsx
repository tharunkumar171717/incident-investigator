import type { Metadata } from "next";
import Link from "next/link";
import { History, Plus } from "lucide-react";
import { IncidentStatusBadge, InvestigationBadge, SeverityBadge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { listIncidents, listRepositories, PAGE_SIZE } from "@/lib/data";
import { formatDuration, formatRelative } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { historyFilterSchema } from "@/lib/validation";

export const metadata: Metadata = { title: "Investigations" };
export const dynamic = "force-dynamic";

export default async function HistoryPage(props: PageProps<"/incidents">) {
  const sp = await props.searchParams;
  const flat = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([, v]) => v));
  const filters = historyFilterSchema.parse(flat);
  const supabase = await createClient();
  const [{ rows, count, page }, repos] = await Promise.all([listIncidents(supabase, filters), listRepositories(supabase)]);
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const hasFilters = Object.keys(flat).some((k) => k !== "page");
  const pageHref = (p: number) => `/incidents?${new URLSearchParams({ ...(flat as Record<string, string>), page: String(p) })}`;

  return (
    <>
      <PageHeader
        title="Investigation history"
        description={`${count} incident(s)${hasFilters ? " matching filters" : ""}`}
        actions={
          <Link href="/incidents/new" className={buttonClass("primary")}>
            <Plus className="size-4" /> New incident
          </Link>
        }
      />

      <Card className="mb-4 p-3">
        <form className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-[1.4fr_repeat(4,1fr)_auto_auto_auto]" method="get">
          <Input name="q" defaultValue={filters.q} placeholder="Search titles…" className="col-span-2 md:col-span-4 lg:col-span-1" />
          <Select name="severity" defaultValue={filters.severity ?? ""} aria-label="Severity">
            <option value="">Any severity</option>
            {["critical", "high", "medium", "low"].map((s) => (
              <option key={s} value={s} className="capitalize">
                {s}
              </option>
            ))}
          </Select>
          <Select name="status" defaultValue={filters.status ?? ""} aria-label="Status">
            <option value="">Any status</option>
            <option value="open">Open</option>
            <option value="investigating">Investigating</option>
            <option value="root_cause_identified">Root cause identified</option>
            <option value="fix_proposed">Fix proposed</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </Select>
          <Select name="repository" defaultValue={filters.repository ?? ""} aria-label="Repository">
            <option value="">Any repository</option>
            {repos.map((r) => (
              <option key={r.id} value={r.id}>
                {r.full_name}
              </option>
            ))}
          </Select>
          <Select name="result" defaultValue={filters.result ?? ""} aria-label="Result">
            <option value="">Any result</option>
            <option value="root_cause_found">Root cause found</option>
            <option value="inconclusive">Inconclusive</option>
            <option value="error">Failed</option>
            <option value="none">Not investigated</option>
          </Select>
          <Input type="date" name="from" defaultValue={filters.from} aria-label="From date" />
          <Input type="date" name="to" defaultValue={filters.to} aria-label="To date" />
          <div className="flex gap-2">
            <button className={buttonClass("secondary")}>Filter</button>
            {hasFilters && (
              <Link href="/incidents" className={buttonClass("ghost")}>
                Clear
              </Link>
            )}
          </div>
        </form>
      </Card>

      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<History className="size-6" />} title={hasFilters ? "No incidents match these filters" : "No incidents yet"} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-4 py-2 font-medium">Incident</th>
                  <th className="px-4 py-2 font-medium">Severity</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Last investigation</th>
                  <th className="px-4 py-2 font-medium">Repository</th>
                  <th className="px-4 py-2 font-medium">Duration</th>
                  <th className="px-4 py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const inv = r.investigations[0];
                  return (
                    <tr key={r.id} className="border-b border-border last:border-0 hover:bg-panel-2/60">
                      <td className="max-w-[340px] px-4 py-2.5">
                        <Link href={`/incidents/${r.id}`} className="block truncate font-medium hover:text-accent">
                          {r.title}
                        </Link>
                        {r.endpoint && <div className="truncate font-mono text-xs text-subtle">{r.endpoint}</div>}
                      </td>
                      <td className="px-4 py-2.5">
                        <SeverityBadge severity={r.severity} />
                      </td>
                      <td className="px-4 py-2.5">
                        <IncidentStatusBadge status={r.status} />
                      </td>
                      <td className="px-4 py-2.5">{inv ? <InvestigationBadge status={inv.status} outcome={inv.outcome} /> : <span className="text-xs text-subtle">—</span>}</td>
                      <td className="max-w-[200px] truncate px-4 py-2.5 font-mono text-xs text-muted">{r.repositories?.full_name ?? "—"}</td>
                      <td className="px-4 py-2.5 tabular-nums text-muted">{formatDuration(inv?.duration_ms)}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted">{formatRelative(r.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-xs text-muted">
          <span>
            Page {page} of {pages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={pageHref(page - 1)} className={buttonClass("secondary", "sm")}>
                Previous
              </Link>
            )}
            {page < pages && (
              <Link href={pageHref(page + 1)} className={buttonClass("secondary", "sm")}>
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </>
  );
}
