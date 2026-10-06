"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  FilePen,
  FileText,
  FlaskConical,
  FolderTree,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  Lightbulb,
  Loader2,
  Play,
  ScrollText,
  Search,
  Siren,
  Workflow,
  Wrench,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { InvestigationStepRow } from "@/lib/db/types";
import { formatDuration } from "@/lib/format";

const TOOL_ICON: Record<string, LucideIcon> = {
  list_repository_files: FolderTree,
  search_code: Search,
  read_file: FileText,
  get_file: FileText,
  find_references: Workflow,
  get_recent_commits: GitCommitHorizontal,
  get_commit: GitCommitHorizontal,
  get_branch: GitBranch,
  query_logs: ScrollText,
  propose_fix: Wrench,
  write_test: FlaskConical,
  run_tests: Play,
  submit_report: ClipboardCheck,
  create_branch: GitBranch,
  update_file: FilePen,
  create_pull_request: GitPullRequest,
};

function iconFor(step: InvestigationStepRow): { Icon: LucideIcon; tone: string } {
  if (step.status === "running") return { Icon: Loader2, tone: "text-accent" };
  if (step.kind === "error" || step.status === "error") return { Icon: XCircle, tone: "text-bad" };
  if (step.kind === "warning") return { Icon: AlertTriangle, tone: "text-warn" };
  if (step.kind === "thought") return { Icon: Lightbulb, tone: "text-subtle" };
  if (step.kind === "tool_call") return { Icon: TOOL_ICON[step.tool_name ?? ""] ?? Workflow, tone: "text-accent" };
  if (/PR #|pull request/i.test(step.title)) return { Icon: GitPullRequest, tone: "text-ok" };
  return { Icon: CheckCircle2, tone: "text-ok" };
}

export function Timeline({ steps, incidentCreatedAt, showThoughts = true, compact = false }: { steps: InvestigationStepRow[]; incidentCreatedAt?: string; showThoughts?: boolean; compact?: boolean }) {
  const visible = showThoughts ? steps : steps.filter((s) => s.kind !== "thought");
  return (
    <ol className="relative">
      {incidentCreatedAt && (
        <TimelineRow
          Icon={Siren}
          tone="text-muted"
          title="Incident created"
          time={incidentCreatedAt}
          last={visible.length === 0}
        />
      )}
      {visible.map((s, i) => (
        <StepRow key={s.id} step={s} last={i === visible.length - 1} compact={compact} />
      ))}
    </ol>
  );
}

function StepRow({ step, last, compact }: { step: InvestigationStepRow; last: boolean; compact: boolean }) {
  const [open, setOpen] = useState(false);
  const { Icon, tone } = iconFor(step);
  const expandable = !compact && Boolean(step.tool_input || step.tool_output || (step.detail && step.detail.length > 140));
  return (
    <TimelineRow
      Icon={Icon}
      tone={tone}
      spin={step.status === "running"}
      title={step.title}
      chip={step.kind === "tool_call" ? step.tool_name : null}
      detail={step.detail && (!expandable || !open) ? step.detail : null}
      dim={step.kind === "thought"}
      time={step.started_at}
      duration={step.status === "running" ? null : step.duration_ms}
      last={last}
      onToggle={expandable ? () => setOpen((o) => !o) : undefined}
      open={open}
    >
      {open && (
        <div className="mt-2 space-y-2">
          {step.detail && step.detail.length > 140 && <p className="whitespace-pre-wrap text-xs text-muted">{step.detail}</p>}
          {step.tool_input && Object.keys(step.tool_input).length > 0 && (
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-subtle">Input</div>
              <pre className="max-h-64 overflow-auto rounded-md border border-border bg-code p-2.5 font-mono text-[11.5px] leading-relaxed">{JSON.stringify(step.tool_input, null, 2)}</pre>
            </div>
          )}
          {step.tool_output && (
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-subtle">Result</div>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-code p-2.5 font-mono text-[11.5px] leading-relaxed">{step.tool_output}</pre>
            </div>
          )}
        </div>
      )}
    </TimelineRow>
  );
}

function TimelineRow(props: {
  Icon: LucideIcon;
  tone: string;
  spin?: boolean;
  title: string;
  chip?: string | null;
  detail?: string | null;
  dim?: boolean;
  time?: string;
  duration?: number | null;
  last: boolean;
  onToggle?: () => void;
  open?: boolean;
  children?: React.ReactNode;
}) {
  const { Icon } = props;
  return (
    <li className="relative flex gap-3 pb-3">
      {!props.last && <span className="absolute top-6 bottom-0 left-[11px] w-px bg-border" aria-hidden />}
      <span className={cn("relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-panel", props.tone)}>
        <Icon className={cn("size-3.5", props.spin && "animate-spin")} />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <button
          type="button"
          onClick={props.onToggle}
          disabled={!props.onToggle}
          className={cn("flex w-full items-start gap-2 text-left", props.onToggle && "cursor-pointer")}
        >
          <span className={cn("min-w-0 flex-1 text-sm", props.dim ? "text-muted" : "text-fg")}>
            {props.title}
            {props.chip && <span className="ml-2 rounded bg-panel-2 px-1.5 py-px font-mono text-[10.5px] text-subtle">{props.chip}</span>}
          </span>
          <span className="flex shrink-0 items-center gap-2 pt-0.5 text-[11px] tabular-nums text-subtle">
            {props.duration !== undefined && props.duration !== null && props.duration > 0 && formatDuration(props.duration)}
            {props.time && new Date(props.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            {props.onToggle && <ChevronRight className={cn("size-3.5 transition-transform", props.open && "rotate-90")} />}
          </span>
        </button>
        {props.detail && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{props.detail}</p>}
        {props.children}
      </div>
    </li>
  );
}
