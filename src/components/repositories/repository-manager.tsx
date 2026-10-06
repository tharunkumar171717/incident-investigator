"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, ExternalLink, FolderGit2, GitBranch, Lock, Plus, Settings2, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { Alert, EmptyState, Kbd } from "@/components/ui/misc";
import { apiFetch } from "@/lib/api-client";
import type { RepositoryRow } from "@/lib/db/types";
import { formatRelative } from "@/lib/format";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}
interface Suggestion {
  full_name: string;
  private: boolean;
  description: string | null;
}

export function RepositoryManager({ initial, server }: { initial: RepositoryRow[]; server: { tokenConfigured: boolean; writeTokenConfigured: boolean; testExecution: boolean } }) {
  const [repos, setRepos] = useState(initial);
  const [input, setInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  async function loadSuggestions() {
    if (suggestions || !server.tokenConfigured) return;
    try {
      setSuggestions(await apiFetch<Suggestion[]>("/api/github/repos"));
    } catch (e) {
      setSuggestError((e as Error).message);
    }
  }

  async function connect(value = input) {
    if (!value.trim()) return;
    setConnecting(true);
    try {
      const repo = await apiFetch<RepositoryRow>("/api/repositories", { method: "POST", body: { repository: value } });
      setRepos((r) => [repo, ...r.filter((x) => x.id !== repo.id)]);
      setInput("");
      toast.success(`Connected ${repo.full_name}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setConnecting(false);
    }
  }

  const connected = new Set(repos.map((r) => r.full_name.toLowerCase()));

  return (
    <div className="space-y-5">
      {!server.tokenConfigured && (
        <Alert tone="bad" title="GITHUB_TOKEN is not configured on the server">
          Create a fine-grained personal access token with <b>Contents: read</b> and <b>Metadata: read</b> on the repositories to investigate, add it to <Kbd>.env.local</Kbd> and restart.
        </Alert>
      )}

      <Card>
        <CardHeader title="Connect a repository" description="Enter owner/name or a github.com URL. Access is verified before saving." />
        <CardBody>
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              connect();
            }}
          >
            <Input value={input} onChange={(e) => setInput(e.target.value)} onFocus={loadSuggestions} placeholder="acme/orders-service" className="font-mono sm:max-w-md" list="repo-suggestions" />
            <datalist id="repo-suggestions">
              {suggestions?.filter((s) => !connected.has(s.full_name.toLowerCase())).map((s) => <option key={s.full_name} value={s.full_name} />)}
            </datalist>
            <Button type="submit" variant="primary" loading={connecting} disabled={!server.tokenConfigured}>
              <Plus className="size-4" /> Connect
            </Button>
          </form>
          {suggestError && <p className="mt-2 text-xs text-muted">Could not list repositories for the token: {suggestError}</p>}
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
            <Badge tone={server.tokenConfigured ? "ok" : "bad"}>read token {server.tokenConfigured ? "configured" : "missing"}</Badge>
            <Badge tone={server.writeTokenConfigured ? "ok" : "neutral"}>{server.writeTokenConfigured ? "separate write token for PRs" : "PRs use the read token"}</Badge>
            <Badge tone={server.testExecution ? "warn" : "neutral"}>test execution {server.testExecution ? "enabled" : "disabled"}</Badge>
          </div>
        </CardBody>
      </Card>

      {repos.length === 0 ? (
        <Card>
          <EmptyState icon={<FolderGit2 className="size-6" />} title="No repositories connected" description="Connected repositories can be selected when you create an incident." />
        </Card>
      ) : (
        <div className="space-y-4">
          {repos.map((r) => (
            <RepositoryCard key={r.id} repo={r} onChange={(n) => setRepos((rs) => rs.map((x) => (x.id === n.id ? n : x)))} onRemove={() => setRepos((rs) => rs.filter((x) => x.id !== r.id))} testExecution={server.testExecution} />
          ))}
        </div>
      )}
    </div>
  );
}

function RepositoryCard({ repo, onChange, onRemove, testExecution }: { repo: RepositoryRow; onChange: (r: RepositoryRow) => void; onRemove: () => void; testExecution: boolean }) {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [testing, setTesting] = useState(false);
  const [branches, setBranches] = useState<string[] | null>(null);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [editing, setEditing] = useState(false);
  const [settings, setSettings] = useState({ default_branch: repo.default_branch, test_command: repo.test_command ?? "", setup_command: repo.setup_command ?? "" });
  const [saving, setSaving] = useState(false);
  const meta = repo.metadata as { stars?: number; open_issues?: number; size_kb?: number; pushed_at?: string; archived?: boolean };

  async function testAccess() {
    setTesting(true);
    try {
      const res = await apiFetch<{ ok: boolean; checks: Check[]; repository: RepositoryRow }>(`/api/repositories/${repo.id}/test`, { method: "POST" });
      setChecks(res.checks);
      if (res.repository) onChange(res.repository);
      if (res.ok) toast.success("Repository is accessible");
      else toast.error("Repository access check failed");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTesting(false);
    }
  }

  async function loadBranches() {
    setLoadingBranches(true);
    try {
      setBranches((await apiFetch<{ branches: string[] }>(`/api/repositories/${repo.id}/branches`)).branches);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoadingBranches(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      onChange(await apiFetch<RepositoryRow>(`/api/repositories/${repo.id}`, { method: "PATCH", body: settings }));
      setEditing(false);
      toast.success("Settings saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(`Disconnect ${repo.full_name}? Existing incidents are kept.`)) return;
    try {
      await apiFetch(`/api/repositories/${repo.id}`, { method: "DELETE" });
      onRemove();
      toast.success("Repository disconnected");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <FolderGit2 className="size-4 text-muted" />
            <span className="font-mono text-sm font-semibold">{repo.full_name}</span>
            {repo.is_private && (
              <Badge>
                <Lock className="size-3" /> private
              </Badge>
            )}
            {repo.language && <Badge>{repo.language}</Badge>}
            {repo.last_error ? <Badge tone="bad">access error</Badge> : repo.last_verified_at ? <Badge tone="ok">verified {formatRelative(repo.last_verified_at)}</Badge> : null}
            <Badge tone={repo.can_push ? "accent" : "neutral"}>{repo.can_push ? "can open PRs" : "read-only"}</Badge>
            {meta.archived && <Badge tone="warn">archived</Badge>}
          </div>
          {repo.description && <p className="mt-1 text-xs text-muted">{repo.description}</p>}
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle">
            <span className="flex items-center gap-1">
              <GitBranch className="size-3" /> {repo.default_branch}
            </span>
            {meta.size_kb !== undefined && <span>{(meta.size_kb / 1024).toFixed(1)} MB</span>}
            {meta.stars !== undefined && <span>{meta.stars} stars</span>}
            {meta.pushed_at && <span>pushed {formatRelative(meta.pushed_at)}</span>}
            <span>tests: {repo.test_command ? <code className="font-mono">{repo.test_command}</code> : "not configured"}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" onClick={testAccess} loading={testing}>
            <ShieldCheck className="size-3.5" /> Test access
          </Button>
          <Button size="sm" onClick={loadBranches} loading={loadingBranches}>
            <GitBranch className="size-3.5" /> Branches
          </Button>
          <Button size="sm" onClick={() => setEditing((e) => !e)}>
            <Settings2 className="size-3.5" /> Settings
          </Button>
          <Link href={`/incidents/new?repository=${repo.id}`} className={buttonClass("secondary", "sm")}>
            <Plus className="size-3.5" /> Incident
          </Link>
          {repo.html_url && (
            <a href={repo.html_url} target="_blank" rel="noreferrer" className={buttonClass("ghost", "sm")} aria-label="Open on GitHub">
              <ExternalLink className="size-3.5" />
            </a>
          )}
          <Button size="sm" variant="ghost" onClick={remove} aria-label="Disconnect">
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {(checks || branches || editing || repo.last_error) && (
        <CardBody className="space-y-4">
          {repo.last_error && !checks && <p className="text-xs text-bad">{repo.last_error}</p>}
          {checks && (
            <ul className="space-y-1.5">
              {checks.map((c) => (
                <li key={c.name} className="flex items-start gap-2 text-sm">
                  {c.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-bad" />}
                  <span>
                    <span className="font-medium">{c.name}</span> <span className="text-muted">— {c.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {branches && (
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted">{branches.length} branch(es)</div>
              <div className="flex max-h-32 flex-wrap gap-1.5 overflow-auto">
                {branches.map((b) => (
                  <span key={b} className={`rounded border px-1.5 py-0.5 font-mono text-[11px] ${b === repo.default_branch ? "border-accent text-accent" : "border-border text-muted"}`}>
                    {b}
                  </span>
                ))}
              </div>
            </div>
          )}
          {editing && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field label="Default branch">
                <Input value={settings.default_branch} onChange={(e) => setSettings({ ...settings, default_branch: e.target.value })} className="font-mono" />
              </Field>
              <Field label="Test command" hint="Run in a sandbox copy, no shell. e.g. npm test, pytest -q, go test ./...">
                <Input value={settings.test_command} onChange={(e) => setSettings({ ...settings, test_command: e.target.value })} placeholder="node --test" className="font-mono" />
              </Field>
              <Field label="Setup command (optional)" hint="e.g. npm ci. Runs before tests.">
                <Input value={settings.setup_command} onChange={(e) => setSettings({ ...settings, setup_command: e.target.value })} placeholder="npm ci" className="font-mono" />
              </Field>
              {!testExecution && <p className="text-xs text-warn md:col-span-3">Test execution is disabled on this server (ENABLE_TEST_EXECUTION=false), so these commands are stored but not run.</p>}
              <div className="flex gap-2 md:col-span-3">
                <Button variant="primary" size="sm" onClick={save} loading={saving}>
                  Save
                </Button>
                <Button size="sm" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardBody>
      )}
    </Card>
  );
}
