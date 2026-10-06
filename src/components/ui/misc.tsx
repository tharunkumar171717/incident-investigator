import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-panel-2", className)} />;
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-3 text-subtle">{icon}</div>}
      <div className="text-sm font-medium text-fg">{title}</div>
      {description && <div className="mt-1 max-w-md text-xs text-muted">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight text-fg">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <code className="rounded border border-border bg-panel-2 px-1 py-px font-mono text-[12px] text-fg">{children}</code>;
}

export function Alert({ tone = "bad", title, children, action }: { tone?: "bad" | "warn" | "info" | "ok"; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const tones = { bad: "border-bad/30 bg-bad-soft text-bad", warn: "border-warn/30 bg-warn-soft text-warn", info: "border-info/30 bg-info-soft text-info", ok: "border-ok/30 bg-ok-soft text-ok" };
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 rounded-lg border px-4 py-3", tones[tone])}>
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        {children && <div className="mt-1 text-xs text-fg/80">{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function ConfidenceMeter({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <span className="text-muted">—</span>;
  const tone = value >= 80 ? "bg-ok" : value >= 55 ? "bg-warn" : "bg-bad";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-panel-2">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.max(2, value)}%` }} />
      </div>
      <span className="tabular-nums text-sm font-semibold">{value}%</span>
    </div>
  );
}
