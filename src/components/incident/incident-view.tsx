"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleStop, GitBranch, Globe, RotateCcw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { IncidentStatusBadge, InvestigationBadge, SeverityBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, ConfidenceMeter, EmptyState } from "@/components/ui/misc";
import { Tabs } from "@/components/ui/tabs";
import { apiFetch } from "@/lib/api-client";
import type { IncidentBundle } from "@/lib/data";
import type { IncidentLogRow, InvestigationStepRow } from "@/lib/db/types";
import { formatDateTime, formatDuration, formatRelative, formatTokens } from "@/lib/format";
import { CodeReferences } from "./code-references";
import { FixPanel } from "./fix-panel";
import { IncidentInput } from "./incident-input";
import { ReportView } from "./report-view";
import { Timeline } from "./timeline";
import { useInvestigationStream } from "./use-investigation-stream";

const ERROR_HINTS: Record<string, string> = {
  github_auth_failed: "The server's GITHUB_TOKEN was rejected. Update it in .env.local and restart.",
  github_access_denied: "The token cannot access this repository. Grant it Contents: read and Metadata: read on the repository.",
  github_not_found: "The repository, branch or commit was not found. Check the incident's branch/commit and the repository connection.",
  github_rate_limited: "GitHub rate limit reached. Wait a few minutes, then retry.",
  github_unavailable: "GitHub could not be reached. Retry shortly.",
  repo_too_large: "The repository archive is larger than MAX_REPO_ARCHIVE_MB.",
  ai_auth: "The AI provider rejected the API key. Check ANTHROPIC_API_KEY / GEMINI_API_KEY.",
  ai_rate_limited: "The AI provider is rate limiting. Retry in a minute.",
  ai_unavailable: "The AI provider failed or timed out. Retry.",
  ai_not_configured: "No AI provider key is configured on the server.",
  timeout: "The investigation exceeded AGENT_MAX_DURATION_SECONDS.",
  limit_reached: "The step/tool/token limits were reached before the agent produced a report. Add more context and retry, or raise the AGENT_MAX_* limits.",
  no_report: "The agent stopped without producing a report. Retry.",
  interrupted: "The server restarted while the investigation was running.",
};

export function IncidentView({ initial, logs }: { initial: IncidentBundle; logs: IncidentLogRow[] }) {
  const router = useRouter();
  const [bundle, setBundle] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const { incident, investigation, finding } = bundle;
  const active = investigation?.status === "running" || investigation?.status === "queued";

  const refresh = useCallback(
    async (investigationId?: string) => {
      try {
        const qs = investigationId ? `?investigation=${investigationId}` : "";
        setBundle(await apiFetch<IncidentBundle>(`/api/incidents/${incident.id}${qs}`));
      } catch (e) {
        toast.error((e as Error).message);
      }
    },
    [incident.id],
  );

  useInvestigationStream(investigation?.id ?? null, active, {
    onStep: (s) =>
      setBundle((b) => {
        const steps = b.steps.filter((x) => x.id !== s.id);
        steps.push(s);
        steps.sort((a, c) => a.seq - c.seq);
        return { ...b, steps };
      }),
    onStatus: (s) => setBundle((b) => (b.investigation && b.investigation.id === s.id ? { ...b, investigation: { ...b.investigation, ...s } } : b)),
    onDone: () => {
      refresh();
      router.refresh();
    },
    onError: (m) => toast.error(m),
  });

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);

  async function action(name: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(name);
    try {
      await fn();
      if (ok) toast.success(ok);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const investigate = () =>
    action("investigate", async () => {
      const r = await apiFetch<{ investigation_id: string }>(`/api/incidents/${incident.id}/investigate`, { method: "POST" });
      await refresh(r.investigation_id);
    }, "Investigation started");
  const cancel = () => investigation && action("cancel", () => apiFetch(`/api/investigations/${investigation.id}/cancel`, { method: "POST" }), "Cancellation requested");
  const setStatus = (status: "open" | "resolved" | "closed") => action(status, () => apiFetch(`/api/incidents/${incident.id}`, { method: "PATCH", body: { status } }), `Marked ${status}`);
  const remove = async () => {
    if (!confirm("Delete this incident and all its investigations?")) return;
    setBusy("delete");
    try {
      await apiFetch(`/api/incidents/${incident.id}`, { method: "DELETE" });
      toast.success("Incident deleted");
      router.push("/incidents");
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(null);
    }
  };

  const elapsed = investigation?.started_at ? (active ? now - new Date(investigation.started_at).getTime() : investigation.duration_ms) : null;
  const toolSteps = bundle.steps.filter((s) => s.kind === "tool_call");
  const report = investigation?.result ?? null;
  const done = investigation?.status === "completed";

  const tabs = useMemo(() => {
    const t = [];
    t.push({
      id: "overview",
      label: "Overview",
      content: finding ? (
        <ReportView finding={finding} />
      ) : (
        <Card>
          <CardHeader title={active ? "Investigation in progress" : "Investigation progress"} description={active ? "Live — every entry is a real backend step or tool call." : undefined} />
          <CardBody>
            {bundle.steps.length ? (
              <Timeline steps={bundle.steps} incidentCreatedAt={incident.created_at} showThoughts={false} compact />
            ) : active ? (
              <p className="text-sm text-muted">Starting…</p>
            ) : (
              <EmptyState icon={<Search className="size-6" />} title="Not investigated yet" description="Start an investigation to analyse this incident against the connected repository." />
            )}
          </CardBody>
        </Card>
      ),
    });
    t.push({ id: "code", label: "Code", count: report?.code_references.length, content: <CodeReferences refs={report?.code_references ?? []} repoUrl={bundle.repository?.html_url ?? null} sha={investigation?.commit_sha ?? null} /> });
    t.push({
      id: "timeline",
      label: "Timeline",
      count: bundle.steps.length,
      content: (
        <Card>
          <CardHeader title="Investigation timeline" description={`${toolSteps.length} tool call(s). Click a step to see its input and result.`} />
          <CardBody>
            {bundle.steps.length ? <Timeline steps={bundle.steps} incidentCreatedAt={incident.created_at} /> : <p className="text-sm text-muted">No steps yet.</p>}
          </CardBody>
        </Card>
      ),
    });
    t.push({
      id: "fix",
      label: "Fix & tests",
      count: bundle.fix?.changes.length,
      content: investigation ? (
        <FixPanel
          investigationId={investigation.id}
          investigationDone={done}
          fix={bundle.fix}
          testsToAdd={report?.tests_to_add ?? []}
          tests={bundle.tests}
          pullRequests={bundle.pullRequests}
          repository={bundle.repository}
          onChanged={() => refresh(investigation.id)}
        />
      ) : (
        <EmptyState title="No investigation yet" />
      ),
    });
    t.push({ id: "input", label: "Incident data", content: <IncidentInput incident={incident} logs={logs} logCount={bundle.logCount} /> });
    return t;
  }, [bundle, finding, active, incident, logs, report, investigation, toolSteps.length, done, refresh]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <SeverityBadge severity={incident.severity} />
            <IncidentStatusBadge status={incident.status} />
            {investigation && <InvestigationBadge status={investigation.status} outcome={investigation.outcome} />}
          </div>
          <h1 className="text-lg font-semibold tracking-tight break-words">{incident.title}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            {incident.endpoint && (
              <span className="flex items-center gap-1 font-mono">
                <Globe className="size-3.5" />
                {incident.endpoint}
              </span>
            )}
            {bundle.repository && (
              <span className="flex items-center gap-1 font-mono">
                <GitBranch className="size-3.5" />
                {bundle.repository.full_name}@{investigation?.ref ?? incident.branch ?? bundle.repository.default_branch}
                {investigation?.commit_sha && <span className="text-subtle">({investigation.commit_sha.slice(0, 7)})</span>}
              </span>
            )}
            <span title={formatDateTime(incident.created_at)}>Created {formatRelative(incident.created_at)}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {active ? (
            <Button onClick={cancel} loading={busy === "cancel"} variant="danger">
              <CircleStop className="size-4" /> Cancel
            </Button>
          ) : (
            <Button variant="primary" onClick={investigate} loading={busy === "investigate"}>
              {investigation ? <RotateCcw className="size-4" /> : <Search className="size-4" />}
              {investigation ? "Re-investigate" : "Investigate"}
            </Button>
          )}
          {incident.status !== "resolved" && incident.status !== "closed" ? (
            <Button onClick={() => setStatus("resolved")} loading={busy === "resolved"} disabled={active}>
              <CheckCircle2 className="size-4" /> Mark resolved
            </Button>
          ) : (
            <Button onClick={() => setStatus("open")} loading={busy === "open"}>
              Reopen
            </Button>
          )}
          <Button variant="ghost" onClick={remove} loading={busy === "delete"} disabled={active} aria-label="Delete incident">
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {/* Failure */}
      {investigation && (investigation.status === "failed" || investigation.status === "cancelled") && (
        <Alert
          tone={investigation.status === "failed" ? "bad" : "warn"}
          title={investigation.status === "failed" ? "Investigation failed" : "Investigation cancelled"}
          action={
            <Button size="sm" onClick={investigate} loading={busy === "investigate"}>
              <RotateCcw className="size-3.5" /> Retry
            </Button>
          }
        >
          {investigation.error}
          {investigation.error_code && ERROR_HINTS[investigation.error_code] && <span className="mt-1 block">{ERROR_HINTS[investigation.error_code]}</span>}
        </Alert>
      )}
      {finding && !finding.root_cause_found && (
        <Alert tone="warn" title="Root cause not established">
          The agent could not confirm a root cause with the available evidence. Add logs, a fuller stack trace or the deployed commit and re-investigate.
        </Alert>
      )}

      {/* Key facts */}
      {investigation && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Fact label="Severity">{report ? <SeverityBadge severity={report.severity} /> : "—"}</Fact>
          <Fact label="Confidence">
            <ConfidenceMeter value={report?.confidence} />
          </Fact>
          <Fact label="Affected service">{report?.affected_service ?? "—"}</Fact>
          <Fact label="Endpoint">
            <span className="font-mono text-xs">{report?.affected_endpoint ?? incident.endpoint ?? "—"}</span>
          </Fact>
          <Fact label={active ? "Elapsed" : "Duration"}>
            <span className="tabular-nums">{formatDuration(elapsed)}</span>
            <span className="ml-1.5 text-[11px] text-subtle">
              {investigation.tool_call_count} tools · {formatTokens(investigation.input_tokens + investigation.output_tokens)} tok
            </span>
          </Fact>
        </div>
      )}

      {bundle.investigations.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          Run:
          {bundle.investigations.map((inv, i) => (
            <button
              key={inv.id}
              onClick={() => refresh(inv.id)}
              className={`rounded border px-2 py-0.5 ${inv.id === investigation?.id ? "border-accent text-fg" : "border-border hover:text-fg"}`}
            >
              #{bundle.investigations.length - i} · {inv.status === "completed" ? (inv.outcome === "root_cause_found" ? "found" : "inconclusive") : inv.status} · {formatRelative(inv.created_at)}
            </button>
          ))}
        </div>
      )}

      <Tabs key={investigation?.id ?? "none"} tabs={tabs} initial="overview" />
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card className="px-3.5 py-3">
      <div className="text-[11px] font-medium text-muted">{label}</div>
      <div className="mt-1 min-h-5 truncate text-sm font-medium">{children}</div>
    </Card>
  );
}

export type { InvestigationStepRow };
