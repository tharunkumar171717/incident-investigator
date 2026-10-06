"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertTriangle, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { apiFetch } from "@/lib/api-client";

interface RepoOption {
  id: string;
  full_name: string;
  default_branch: string;
  can_push: boolean;
  test_command: string | null;
}

const EMPTY = {
  title: "",
  description: "",
  endpoint: "",
  error_message: "",
  stack_trace: "",
  logs: "",
  additional_context: "",
  branch: "",
  commit_sha: "",
};

export function NewIncidentForm({ repositories, defaultRepositoryId }: { repositories: RepoOption[]; defaultRepositoryId?: string }) {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY);
  const [repositoryId, setRepositoryId] = useState(defaultRepositoryId ?? repositories[0]?.id ?? "");
  // Branch list for the selected repository; stale entries (other repo) are ignored.
  const [branchState, setBranchState] = useState<{ repoId: string; branches: string[] | null; error: string | null } | null>(null);
  const current = branchState?.repoId === repositoryId ? branchState : null;
  const branches = current?.branches ?? null;
  const branchError = current?.error ?? null;
  const [autoFix, setAutoFix] = useState(false);
  const [submitting, setSubmitting] = useState<"investigate" | "save" | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const repo = repositories.find((r) => r.id === repositoryId) ?? null;

  useEffect(() => {
    if (!repositoryId) return;
    let cancelled = false;
    apiFetch<{ default_branch: string; branches: string[] }>(`/api/repositories/${repositoryId}/branches`)
      .then((d) => {
        if (cancelled) return;
        setBranchState({ repoId: repositoryId, branches: d.branches, error: null });
        setForm((f) => ({ ...f, branch: d.branches.includes(f.branch) ? f.branch : d.default_branch }));
      })
      .catch((e: Error) => {
        if (!cancelled) setBranchState({ repoId: repositoryId, branches: null, error: e.message });
      });
    return () => {
      cancelled = true;
    };
  }, [repositoryId]);

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(investigate: boolean) {
    const errs: Record<string, string> = {};
    if (form.title.trim().length < 3) errs.title = "Title must be at least 3 characters.";
    if (form.commit_sha && !/^[0-9a-f]{7,40}$/i.test(form.commit_sha.trim())) errs.commit_sha = "Use a 7-40 character hex commit SHA.";
    if (investigate && !form.error_message.trim() && !form.stack_trace.trim() && !form.logs.trim() && !form.description.trim()) {
      errs.error_message = "Provide at least a description, error message, stack trace or logs to investigate.";
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSubmitting(investigate ? "investigate" : "save");
    try {
      const res = await apiFetch<{ id: string; investigation_id: string | null }>("/api/incidents", {
        method: "POST",
        body: { ...form, repository_id: repositoryId || null, auto_fix: autoFix, investigate },
      });
      toast.success(investigate ? "Investigation started" : "Incident saved");
      router.push(`/incidents/${res.id}`);
    } catch (e) {
      toast.error((e as Error).message);
      setSubmitting(null);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-5">
        <Card>
          <CardHeader title="What is happening?" />
          <CardBody className="space-y-4">
            <Field label="Incident title" htmlFor="title" error={errors.title}>
              <Input id="title" value={form.title} onChange={set("title")} placeholder="POST /api/orders is returning 500 errors" autoFocus />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="API endpoint / URL" htmlFor="endpoint" hint="Method and path, if HTTP">
                <Input id="endpoint" value={form.endpoint} onChange={set("endpoint")} placeholder="POST /api/orders" className="font-mono" />
              </Field>
              <Field label="Error message" htmlFor="error_message" error={errors.error_message}>
                <Input id="error_message" value={form.error_message} onChange={set("error_message")} placeholder="TypeError: Cannot read properties of null (reading 'id')" className="font-mono" />
              </Field>
            </div>
            <Field label="Description" htmlFor="description" hint="When it started, who is affected, recent deploys, how to reproduce.">
              <Textarea id="description" rows={3} value={form.description} onChange={set("description")} placeholder="Since the 14:05 deploy roughly 30% of checkout requests fail with 500…" />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Runtime evidence" description="Pasted as-is. Logs are parsed into levels and timestamps and can be queried by the agent." />
          <CardBody className="space-y-4">
            <Field label="Stack trace" htmlFor="stack_trace" hint="Python, Node.js, Java/Kotlin, Go, Ruby and .NET traces are parsed.">
              <Textarea id="stack_trace" rows={8} value={form.stack_trace} onChange={set("stack_trace")} className="font-mono text-xs" spellCheck={false} placeholder={'Traceback (most recent call last):\n  File "app/services/order_service.py", line 142, in create_order\n    ...'} />
            </Field>
            <Field label="Logs" htmlFor="logs" hint="Plain text or JSON lines. Up to 2,000 lines are stored.">
              <Textarea id="logs" rows={8} value={form.logs} onChange={set("logs")} className="font-mono text-xs" spellCheck={false} placeholder={'2026-10-06T14:05:12Z ERROR orders POST /api/orders 500 request_id=…'} />
            </Field>
            <Field label="Additional context" htmlFor="additional_context">
              <Textarea id="additional_context" rows={3} value={form.additional_context} onChange={set("additional_context")} placeholder="Feature flags, config changes, related tickets…" />
            </Field>
          </CardBody>
        </Card>
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader title="Repository" />
          <CardBody className="space-y-4">
            {repositories.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted">
                No repositories connected. <Link href="/repositories" className="text-accent hover:underline">Connect one</Link> so the agent can inspect code — otherwise it can only analyse the incident data.
              </div>
            ) : (
              <>
                <Field label="Repository" htmlFor="repository">
                  <Select id="repository" value={repositoryId} onChange={(e) => setRepositoryId(e.target.value)}>
                    {repositories.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.full_name}
                      </option>
                    ))}
                    <option value="">No repository</option>
                  </Select>
                </Field>
                {repositoryId && (
                  <>
                    <Field label="Branch" htmlFor="branch" error={branchError}>
                      {branches ? (
                        <Select id="branch" value={form.branch} onChange={set("branch")}>
                          {branches.map((b) => (
                            <option key={b} value={b}>
                              {b}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <Input id="branch" value={form.branch} onChange={set("branch")} placeholder={branchError ? repo?.default_branch : "Loading branches…"} disabled={!branchError} />
                      )}
                    </Field>
                    <Field label="Commit (optional)" htmlFor="commit_sha" hint="Pin the investigation to the deployed commit." error={errors.commit_sha}>
                      <Input id="commit_sha" value={form.commit_sha} onChange={set("commit_sha")} placeholder="a1b2c3d" className="font-mono" />
                    </Field>
                    {!repo?.test_command && (
                      <p className="flex gap-1.5 text-xs text-muted">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" />
                        No test command configured for this repository, so generated tests cannot be run.
                      </p>
                    )}
                  </>
                )}
              </>
            )}
          </CardBody>
        </Card>

        {repositoryId && (
          <Card>
            <CardBody>
              <label className="flex cursor-pointer items-start gap-2.5">
                <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={autoFix} onChange={(e) => setAutoFix(e.target.checked)} />
                <span>
                  <span className="text-sm font-medium">Open a PR automatically</span>
                  <span className="mt-0.5 block text-xs text-muted">
                    Skip the review step and create a branch + pull request when the fix is verified by passing tests. Off by default — normally you review the diff and confirm first.
                    {repo && !repo.can_push && <span className="mt-1 block text-warn">The server token is read-only for this repository; PR creation will fail.</span>}
                  </span>
                </span>
              </label>
            </CardBody>
          </Card>
        )}

        <div className="flex flex-col gap-2">
          <Button variant="primary" onClick={() => submit(true)} loading={submitting === "investigate"} disabled={submitting !== null}>
            <Search className="size-4" /> Investigate
          </Button>
          <Button onClick={() => submit(false)} loading={submitting === "save"} disabled={submitting !== null}>
            Save without investigating
          </Button>
        </div>
      </div>
    </div>
  );
}
