import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { STATUS_LABEL } from "@/lib/format";

export type Tone = "neutral" | "accent" | "ok" | "warn" | "bad" | "info";

const TONES: Record<Tone, string> = {
  neutral: "bg-panel-2 text-muted border-border",
  accent: "bg-accent-soft text-accent border-transparent",
  ok: "bg-ok-soft text-ok border-transparent",
  warn: "bg-warn-soft text-warn border-transparent",
  bad: "bg-bad-soft text-bad border-transparent",
  info: "bg-info-soft text-info border-transparent",
};

export function Badge({ tone = "neutral", children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex h-5 items-center gap-1.5 rounded border px-1.5 text-[11px] font-medium whitespace-nowrap", TONES[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

const SEVERITY_TONE: Record<string, Tone> = { critical: "bad", high: "warn", medium: "info", low: "neutral" };

export function SeverityBadge({ severity }: { severity: string | null | undefined }) {
  if (!severity) return <Badge>Unassessed</Badge>;
  return (
    <Badge tone={SEVERITY_TONE[severity] ?? "neutral"} dot className="capitalize">
      {severity}
    </Badge>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  open: "neutral",
  investigating: "accent",
  root_cause_identified: "info",
  fix_proposed: "warn",
  resolved: "ok",
  closed: "neutral",
};

export function IncidentStatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{STATUS_LABEL[status] ?? status}</Badge>;
}

export function InvestigationBadge({ status, outcome }: { status: string; outcome?: string | null }) {
  if (status === "running" || status === "queued")
    return (
      <Badge tone="accent">
        <span className="size-1.5 rounded-full bg-current animate-pulse-dot" />
        {status === "queued" ? "Queued" : "Running"}
      </Badge>
    );
  if (status === "failed") return <Badge tone="bad">Failed</Badge>;
  if (status === "cancelled") return <Badge>Cancelled</Badge>;
  if (outcome === "root_cause_found") return <Badge tone="ok">Root cause found</Badge>;
  if (outcome === "inconclusive") return <Badge tone="warn">Inconclusive</Badge>;
  return <Badge>{status}</Badge>;
}
