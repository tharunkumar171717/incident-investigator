"use client";

import { useState } from "react";
import { CheckCircle2, ExternalLink, FlaskConical, GitPullRequest, XCircle } from "lucide-react";
import { toast } from "sonner";
import { DiffView } from "@/components/code/diff-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Alert, EmptyState } from "@/components/ui/misc";
import { apiFetch } from "@/lib/api-client";
import type { PullRequestRow, RepositoryRow, SuggestedFixRow, TestResultRow } from "@/lib/db/types";
import { formatDuration, formatRelative } from "@/lib/format";

const TEST_TONE = { passed: "ok", failed: "bad", error: "bad", skipped: "neutral" } as const;

export function FixPanel(props: {
  investigationId: string;
  investigationDone: boolean;
  fix: SuggestedFixRow | null;
  testsToAdd: string[];
  tests: TestResultRow[];
  pullRequests: PullRequestRow[];
  repository: RepositoryRow | null;
  onChanged: () => void;
}) {
  const { fix, tests, pullRequests, repository } = props;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [creating, setCreating] = useState(false);
  const openPr = pullRequests.find((p) => p.status === "open" || p.status === "creating");
  const failedPr = !openPr ? pullRequests.find((p) => p.status === "failed") : null;
  const hasCodeFix = Boolean(fix?.changes.some((c) => c.kind === "fix"));

  async function createPr() {
    if (!fix) return;
    setCreating(true);
    try {
      const pr = await apiFetch<PullRequestRow>(`/api/investigations/${props.investigationId}/pull-request`, { method: "POST", body: { fix_id: fix.id, confirm: true } });
      toast.success(`Pull request #${pr.number} created`);
      setConfirmOpen(false);
      props.onChanged();
    } catch (e) {
      toast.error((e as Error).message);
      props.onChanged();
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Pull request ------------------------------------------------------ */}
      {openPr ? (
        <Alert
          tone="ok"
          title={
            <span className="flex items-center gap-2">
              <GitPullRequest className="size-4" />
              {openPr.status === "creating" ? "Pull request is being created…" : `Pull request #${openPr.number} open`}
              {openPr.trigger === "auto" && <Badge>auto-fix</Badge>}
            </span>
          }
          action={
            openPr.url && (
              <a href={openPr.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sm font-medium text-ok hover:underline">
                Open on GitHub <ExternalLink className="size-3.5" />
              </a>
            )
          }
        >
          <span className="font-mono">{openPr.branch}</span> → <span className="font-mono">{openPr.base_branch}</span> · {formatRelative(openPr.created_at)}
        </Alert>
      ) : (
        hasCodeFix &&
        props.investigationDone && (
          <Card>
            <CardBody className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Create a pull request</div>
                <p className="text-xs text-muted">
                  Creates a new branch from the investigated commit and commits the {fix!.changes.length} file(s) below. Nothing is pushed until you confirm.
                </p>
                {failedPr && <p className="mt-1 text-xs text-bad">Last attempt failed: {failedPr.error}</p>}
                {repository && !repository.can_push && <p className="mt-1 text-xs text-warn">The server token appears to be read-only for {repository.full_name}.</p>}
              </div>
              <Button variant="primary" onClick={() => setConfirmOpen(true)}>
                <GitPullRequest className="size-4" /> {failedPr ? "Retry pull request" : "Review & create PR"}
              </Button>
            </CardBody>
          </Card>
        )
      )}

      {/* Proposed changes --------------------------------------------------- */}
      <Card>
        <CardHeader
          title="Proposed changes"
          description={fix ? fix.description : undefined}
          actions={fix && <Badge tone={fix.status === "verified" ? "ok" : fix.status === "failed_verification" ? "bad" : fix.status === "applied" ? "accent" : "neutral"}>{fix.status.replace("_", " ")}</Badge>}
        />
        <CardBody className="space-y-4">
          {fix?.changes.length ? (
            fix.changes.map((c) => (
              <div key={c.path}>
                <div className="mb-1.5 flex items-center gap-2 text-xs text-muted">
                  {c.kind === "test" ? <FlaskConical className="size-3.5" /> : null}
                  {c.kind === "test" ? "Regression test" : "Fix"}
                </div>
                <DiffView diff={c.diff} path={c.path} isNew={c.original === null} />
              </div>
            ))
          ) : (
            <EmptyState title="No code changes proposed" description={props.investigationDone ? "The agent did not propose a code change (for example because the root cause was not established or no repository was connected)." : "Changes appear here if the agent proposes a fix."} />
          )}
        </CardBody>
      </Card>

      {/* Tests --------------------------------------------------------------- */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Tests to add" />
          <CardBody>
            {props.testsToAdd.length ? (
              <ul className="list-disc space-y-1.5 pl-4 text-sm">
                {props.testsToAdd.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">None listed.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Test results" description={repository?.test_command ? `Command: ${repository.test_command}` : "No test command configured"} />
          {tests.length ? (
            <ul className="divide-y divide-border">
              {tests.map((t) => (
                <TestResult key={t.id} t={t} />
              ))}
            </ul>
          ) : (
            <CardBody>
              <p className="text-sm text-muted">No tests were run.</p>
            </CardBody>
          )}
        </Card>
      </div>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Create pull request?"
        wide
        footer={
          <>
            <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={createPr} loading={creating} disabled={!acknowledged}>
              Create branch & open PR
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted">
            This will write to <span className="font-mono text-fg">{repository?.full_name}</span>: create a new branch, commit {fix?.changes.length} file(s) and open a pull request against{" "}
            <span className="font-mono text-fg">{repository?.default_branch}</span>. The default branch itself is not modified.
          </p>
          {fix?.status !== "verified" && <Alert tone="warn" title="This fix has not been verified by passing tests." />}
          {fix?.changes.map((c) => (
            <DiffView key={c.path} diff={c.diff} path={c.path} isNew={c.original === null} />
          ))}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="accent-[var(--accent)]" />
            I reviewed these changes and want to open a pull request.
          </label>
        </div>
      </Dialog>
    </div>
  );
}

function TestResult({ t }: { t: TestResultRow }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="px-4 py-2.5">
      <button className="flex w-full items-center gap-2 text-left" onClick={() => setOpen((o) => !o)}>
        {t.status === "passed" ? <CheckCircle2 className="size-4 text-ok" /> : t.status === "skipped" ? <FlaskConical className="size-4 text-subtle" /> : <XCircle className="size-4 text-bad" />}
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{t.command}</span>
        <Badge tone={TEST_TONE[t.status]}>{t.status}</Badge>
        <span className="text-[11px] tabular-nums text-subtle">{formatDuration(t.duration_ms)}</span>
      </button>
      {open && t.output && <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-code p-2.5 font-mono text-[11.5px]">{t.output}</pre>}
    </li>
  );
}
