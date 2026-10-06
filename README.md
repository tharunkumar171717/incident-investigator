# AI Incident Investigator

A full-stack Next.js app that investigates production incidents against a GitHub
repository. You describe an incident (error, stack trace, endpoint, logs); an AI
agent then **investigates with tools**. It searches and reads the code, follows the
call chain, checks recent commits and queries the logs. It reports a root cause
with evidence, a severity and a confidence, proposes a fix and a regression
test, optionally runs the tests in a sandbox, and opens a pull request after
you confirm it.

Every status on the investigation timeline is a row the backend wrote while
doing that work. Nothing in the UI is simulated.

```
Browser (Next.js App Router, React 19)
  │  cookie session (Supabase Auth) — no secrets, no Supabase key in the browser
  ▼
Next.js server: pages + /api route handlers + proxy.ts (session refresh / gate)
  ├─ Supabase Postgres (RLS)   incidents, logs, investigations, steps, findings, fixes, tests, PRs
  ├─ Investigation runner      after() background task, agent loop, limits, cancellation
  │    ├─ LLM provider         Anthropic (default) | Gemini  — src/lib/ai
  │    └─ Tool registry        src/lib/tools  ← also exposed as an MCP server (scripts/mcp-server.mts)
  │         ├─ repo snapshot   tarball of the exact commit, searched locally (never sent wholesale)
  │         ├─ GitHub API      commits, branches; write tools only after user confirmation
  │         └─ test sandbox    temp copy + configured test command, no shell, no secrets
  └─ SSE stream                /api/investigations/:id/stream → live timeline
```

## Reuse of your existing Supabase project

This project **does not create a new Supabase project**. It reuses the project
already configured in `../live-location-tracker` (also used by
`fastapi-learning` and `task-manager-api-tharun`):

| Reused | How |
|---|---|
| Supabase project, URL, keys | Same env var names as `live-location-tracker/server/.env`: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `DATABASE_URL`. |
| Auth (email/password + Google) | Same Supabase Auth users and the Google provider already set up there. `http://localhost:3000/auth/callback` is already an allowed redirect URL. |
| `public.profiles` + `on_auth_user_created` trigger | Used as the "users" entity. The migration creates them only if missing, and leaves the existing `handle_new_user()` alone. |
| Migration style | `npm run db:migrate` (plain SQL files, idempotent) like `server/scripts/migrate.js`. |

Existing tables (`profiles`, `tracking_*`, `location_history`, `copilot_*`,
`users`, `Users`, `Tasks`) are not touched. The new tables don't collide with them.

## Setup

Requirements: Node.js 20.9+ (tested on 26), a GitHub token, an Anthropic API key
(or Gemini).

```sh
npm install
cp .env.example .env.local      # then fill in the values (see below)
npm run db:migrate              # creates the tables/RLS in the existing Supabase project
npm run dev                     # http://localhost:3000
```

### Environment

All variables are server-only. See `.env.example` for the full list with comments.

- **Supabase:** copy `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` and
  `DATABASE_URL` from `../live-location-tracker/server/.env`. `DATABASE_URL` must
  be the session pooler on port 5432, and is only needed for migrations.
- **AI:** `ANTHROPIC_API_KEY` (default model `claude-opus-5-5`, effort `high`), or
  `AI_PROVIDER=gemini` + `GEMINI_API_KEY`.
- **GitHub:** `GITHUB_TOKEN`, a **fine-grained** personal access token limited to the
  repositories you investigate, with *Contents: Read* and *Metadata: Read* only.
  To let the app open PRs, add `GITHUB_WRITE_TOKEN` with *Contents: Read and write*
  and *Pull requests: Read and write*. Without it, the read token is used and PR
  creation fails cleanly if that token is read-only. `GITHUB_ALLOWED_OWNERS`
  optionally restricts which owners can be connected.
- **Test execution:** `ENABLE_TEST_EXECUTION=true` runs the repository's configured
  test command on this server (see Security). It is off by default.
- **Limits:** `AGENT_MAX_STEPS`, `AGENT_MAX_TOOL_CALLS`, `AGENT_MAX_TOKENS`,
  `AGENT_MAX_DURATION_SECONDS`, `TOOL_TIMEOUT_SECONDS`, `MAX_REPO_ARCHIVE_MB`.

Env vars are validated with zod on first use. A missing or invalid value shows a
clear error naming the variable.

### Database

`supabase/migrations/20261006000000_incident_investigator.sql` creates:

`repositories`, `incidents`, `incident_logs`, `investigations`,
`investigation_steps`, `root_cause_findings`, `suggested_fixes`, `test_results` and
`pull_requests`. Each has foreign keys to `profiles`, indexes on the common query
paths, `created_at`/`updated_at` timestamps with an update trigger, and check
constraints on all enums.

**Row Level Security** is enabled on every table:

- Users can **select** only rows where `user_id = auth.uid()`.
- Users can **insert, update and delete** only their own `repositories`, `incidents`
  and `incident_logs`.
- Investigation output (steps, findings, fixes, tests, PRs) is written only by the
  server runner, using the secret key. The runner always sets `user_id` explicitly
  and scopes every query by it.
- A trigger prevents an incident from referencing another user's repository.

Run the migration with `npm run db:migrate`, or paste the SQL file into the
Supabase SQL editor; it is idempotent.

## Using it

1. **Repositories:** connect `owner/name` (or a GitHub URL). The app verifies access
   and stores the metadata. *Test access* checks metadata, contents and history
   reads, and whether the token can push. Under *Settings*, set a test command (for
   example `npm test`, `pytest -q`, `go test ./...`) and an optional setup command
   (`npm ci`).
2. **New incident:** enter a title, description, endpoint, error, stack trace and logs,
   and pick a repository, branch and optional commit. Then click **Investigate**.
3. **Incident page:** progress streams live, with every tool call and its input and
   output. When the investigation finishes you get:
   - **Overview:** root cause, summary, evidence, call chain, affected files, risk and
     recommended action.
   - **Code:** the cited code regions, fetched from the snapshot by the server (not
     generated by the model), with syntax highlighting, line numbers, highlighted
     lines, the reason each region matters, and a GitHub permalink.
   - **Timeline:** the full step and tool-call log.
   - **Fix & tests:** the diff, tests to add, test results (with output) and PR status.
     **Review & create PR** shows the diff again and requires an explicit
     acknowledgement before anything is written to GitHub.
4. **Investigations:** history with filters by severity, status, repository, result,
   date range and title search.

### Try it with the bundled demo

`examples/orders-service` is a tiny zero-dependency Node service with a real
bug: `POST /api/orders` returns 500 for soft-deleted users. Its README has a
ready-to-paste incident (stack trace and logs). Push it to a GitHub repository,
connect it, set the test command to `node --test`, set `ENABLE_TEST_EXECUTION=true`,
and investigate.

## How the agent works

`src/lib/agent/runner.ts` runs a structured loop:

1. **Understand.** Parse the stack trace (Python, Node, Java/Kotlin, Go, Ruby, .NET),
   summarize the logs, resolve the branch to a commit SHA, and download that
   commit's tarball into a local, cached, read-only snapshot.
2. **Decide → act → observe.** The model gets an incident brief and the tool list,
   and chooses tools itself. Each call is validated with zod, run with a timeout,
   recorded as a timeline step, and returned to the model in compact form. Only
   targeted search results and line ranges ever reach the model, never the whole
   repository.
3. **Fix and validate.** `propose_fix` takes exact search/replace edits, which must
   match exactly once. `write_test` adds a regression test. `run_tests` runs it in a
   sandbox, first without the fix (to reproduce the bug), then with it (to verify).
4. **Report.** `submit_report` must match the result schema
   (`src/lib/agent/report-schema.ts`). The server validates it, replaces the cited
   line ranges with real code from the snapshot, and stores it.

The system prompt requires evidence-backed claims, honest `root_cause_found=false` and
low confidence when the evidence is thin, and never claiming tests passed unless
`run_tests` reported a pass. It also treats incident text, logs and repository
content as untrusted data, to defend against prompt injection.

**Guards:**

- Maximum steps, tool calls, tokens and wall-clock time. Near the limit the agent is
  told to wrap up; at the limit only `submit_report` is accepted, then the run ends.
- Identical repeated calls are refused, and a repeating agent is forced to report.
- Each tool has its own timeout. Cancellation works through the UI, even across
  server processes, via a database flag.
- Runs whose worker died (for example on a server restart) are marked `interrupted`
  so they can be retried.

**Anthropic specifics** (`src/lib/ai/anthropic.ts`):

- Model `claude-opus-5-5`, with adaptive thinking (summaries shown as "thought" steps)
  and `effort` set from `ANTHROPIC_EFFORT`.
- Streaming requests with eager tool-input streaming.
- Top-level prompt caching, which makes the growing history cheap across turns.
- The server-side refusal fallback (`fallbacks: "default"`) is enabled. It reruns a
  rare policy decline on a fallback model instead of failing the investigation;
  remove those two lines to opt out.

### Tools

| Tool | Kind | Notes |
|---|---|---|
| `list_repository_files` | read | Path prefix and glob filter |
| `search_code` | read | Literal or regex search across the snapshot, with file:line results |
| `read_file` | read | Line ranges (300 lines max), numbered |
| `get_file` | read | Metadata plus the first 150 lines |
| `find_references` | read | Definitions vs. usages, for following call chains |
| `get_recent_commits` / `get_commit` / `get_branch` | read | GitHub API; patches truncated |
| `query_logs` | read | The incident's stored logs, filtered by level and substring |
| `propose_fix` / `write_test` / `run_tests` | propose | Local only; never touches GitHub |
| `submit_report` | control | Ends the run |
| `create_branch` / `update_file` / `create_pull_request` | write | **Never offered to the agent.** Run only by the PR service after confirmation or the incident's auto-fix opt-in |

### MCP server

The same read-only tools are available to any MCP client over stdio:

```sh
MCP_REPOSITORY=owner/name MCP_REF=main npm run mcp
```

Example Claude Code / Claude Desktop config:

```json
{ "mcpServers": { "incident-github": {
  "command": "npm", "args": ["run", "-s", "mcp"],
  "cwd": "/path/to/incident-investigator",
  "env": { "MCP_REPOSITORY": "owner/name" } } } }
```

## Security

- **Secrets stay on the server.**
  - GitHub tokens, the Supabase secret key and AI keys live only in server env.
  - The browser has no Supabase key at all: sign-in runs through server actions,
    and data loads through server components or this app's API.
  - The test sandbox's child process gets a minimal environment, with no secrets.
- **Least-privilege GitHub access.** Use a read-only token for investigations and an
  optional separate write token for PRs. `GITHUB_ALLOWED_OWNERS` can add an owner
  allow-list.
- **No repository modification without confirmation.**
  - PRs require `confirm: true` from the review dialog.
  - Auto-PR is a per-incident opt-in, off by default. Even then it runs only when the
    fix was verified by passing tests (or test execution is unavailable and
    confidence is at least 80).
  - PRs always go to a new `ai-fix/...` branch; the base branch is never written.
- **Test execution runs repository code on your server.**
  - It is disabled by default.
  - Commands come only from the repository settings, are split into argv (no shell,
    no `;&|<>$`), and run in a throwaway copy with a timeout.
  - The agent can only choose a test file target, which is validated.
  - Enable it only for trusted repositories, ideally inside a container.
- **Inputs are validated.** Every API body uses zod, every tool input uses zod,
  repository paths are confined to the snapshot, and all data access is enforced by
  RLS.

## Development

```sh
npm run typecheck   # next typegen + tsc
npm run lint
npm test            # parser, schema and tool-pipeline tests (incl. a real sandboxed
                    # fail-without-fix / pass-with-fix run on examples/orders-service)
npm run build
```

Project layout:

```
src/app/(app)/...          dashboard, incidents (history, new, [id]), repositories
src/app/api/...            route handlers (incidents, investigations, repositories, github)
src/app/login, auth/*      Supabase Auth via server actions + PKCE callback
src/lib/agent/             runner (loop + limits), prompt, parsers, report schema, PR service, recorder
src/lib/ai/                provider interface + Anthropic and Gemini adapters
src/lib/tools/             tool registry and implementations, sandboxed test runner
src/lib/github/            Octokit clients, error mapping, repository snapshot
src/lib/supabase/          server (RLS) / admin (runner) / proxy clients
src/components/            UI: timeline, code viewer (Shiki), diff viewer, report, fix panel, …
supabase/migrations/       schema + RLS
scripts/                   db:migrate, MCP server
examples/orders-service/   demo repository with a real bug
```

**To add an AI provider:** implement `LLMProvider` in `src/lib/ai/types.ts`, then
register it in `src/lib/ai/index.ts`.

**To add a tool:** create it with `defineTool` (zod schema, timeline label and
`run`), then add it to `src/lib/tools/registry.ts`.

## Deployment notes and limitations

- **Hosting.** Investigations run in the background with `after()` and take minutes.
  Run on a long-lived Node server (`npm run build && npm start`, Docker, Railway, a
  VM) or a platform that supports a long `maxDuration` (set to 800s on the relevant
  routes). For production, run the runner on a job queue.
- **One GitHub identity per server.** This instance uses one server-level GitHub
  token. Users can connect any repository that token can see, optionally restricted
  by `GITHUB_ALLOWED_OWNERS`. Per-user GitHub OAuth would need an encrypted token
  store.
- **No sharing.** RLS limits all rows to their owner. Sharing would need a sharing
  table and extra policies.
- **Snapshot storage.** Snapshots are cached in the OS temp directory, keyed by
  commit SHA.
