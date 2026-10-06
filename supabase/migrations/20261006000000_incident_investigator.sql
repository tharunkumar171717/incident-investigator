-- AI Incident Investigator schema.
--
-- Shares the existing Supabase project with live-location-tracker and friends.
-- It REUSES public.profiles (1:1 with auth.users, created by the
-- on_auth_user_created trigger from live-location-tracker) as the "users"
-- entity, and only creates it when it does not exist yet. Every statement is
-- idempotent, so re-running this file is safe.
--
-- auth.users -> profiles -> repositories
--                        -> incidents -> incident_logs
--                                     -> investigations -> investigation_steps
--                                                       -> root_cause_findings
--                                                       -> suggested_fixes -> test_results
--                                                                          -> pull_requests

create extension if not exists pgcrypto;

-- Profiles (reused) -----------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- Only install the signup trigger if no other app already did; the existing
-- handle_new_user() belongs to live-location-tracker and is left untouched.
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'handle_new_user'
  ) then
    create function public.handle_new_user()
    returns trigger language plpgsql security definer set search_path = public as $fn$
    begin
      insert into public.profiles (id, email, full_name, avatar_url)
      values (
        new.id, new.email,
        coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
        coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
      )
      on conflict (id) do nothing;
      return new;
    end;
    $fn$;
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'on_auth_user_created' and tgrelid = 'auth.users'::regclass
  ) then
    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute function public.handle_new_user();
  end if;
end $$;

-- Backfill profiles for users that signed up before the trigger existed.
insert into public.profiles (id, email)
select u.id, u.email from auth.users u
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles: read self') then
    create policy "profiles: read self" on public.profiles for select to authenticated using (id = auth.uid());
  end if;
end $$;

-- Shared updated_at trigger ---------------------------------------------------
create or replace function public.ii_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Repositories ----------------------------------------------------------------
create table if not exists public.repositories (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles (id) on delete cascade,
  provider          text not null default 'github' check (provider in ('github')),
  owner             text not null,
  name              text not null,
  full_name         text generated always as (owner || '/' || name) stored,
  default_branch    text not null default 'main',
  html_url          text,
  description       text,
  language          text,
  is_private        boolean not null default false,
  can_push          boolean not null default false,
  test_command      text check (test_command is null or char_length(test_command) <= 300),
  setup_command     text check (setup_command is null or char_length(setup_command) <= 300),
  metadata          jsonb not null default '{}'::jsonb,
  last_verified_at  timestamptz,
  last_error        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, owner, name)
);
create index if not exists repositories_user_idx on public.repositories (user_id, created_at desc);
drop trigger if exists repositories_touch on public.repositories;
create trigger repositories_touch before update on public.repositories
  for each row execute function public.ii_touch_updated_at();

-- Incidents -------------------------------------------------------------------
create table if not exists public.incidents (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles (id) on delete cascade,
  repository_id       uuid references public.repositories (id) on delete set null,
  title               text not null check (char_length(title) between 3 and 200),
  description         text,
  endpoint            text,
  error_message       text,
  stack_trace         text,
  additional_context  text,
  branch              text,
  commit_sha          text,
  auto_fix            boolean not null default false,
  severity            text check (severity in ('critical', 'high', 'medium', 'low')),
  status              text not null default 'open'
                      check (status in ('open', 'investigating', 'root_cause_identified', 'fix_proposed', 'resolved', 'closed')),
  resolved_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists incidents_user_created_idx on public.incidents (user_id, created_at desc);
create index if not exists incidents_user_status_idx on public.incidents (user_id, status);
create index if not exists incidents_user_severity_idx on public.incidents (user_id, severity);
create index if not exists incidents_repository_idx on public.incidents (repository_id);
drop trigger if exists incidents_touch on public.incidents;
create trigger incidents_touch before update on public.incidents
  for each row execute function public.ii_touch_updated_at();

-- Incident logs ---------------------------------------------------------------
create table if not exists public.incident_logs (
  id           bigint generated always as identity primary key,
  incident_id  uuid not null references public.incidents (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  line_no      integer not null,
  level        text check (level in ('fatal', 'error', 'warn', 'info', 'debug', 'trace')),
  message      text not null,
  source       text,
  logged_at    timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists incident_logs_incident_idx on public.incident_logs (incident_id, line_no);

-- Investigations --------------------------------------------------------------
create table if not exists public.investigations (
  id               uuid primary key default gen_random_uuid(),
  incident_id      uuid not null references public.incidents (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  repository_id    uuid references public.repositories (id) on delete set null,
  status           text not null default 'queued'
                   check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  outcome          text check (outcome in ('root_cause_found', 'inconclusive', 'error')),
  provider         text not null,
  model            text not null,
  ref              text,
  commit_sha       text,
  step_count       integer not null default 0,
  tool_call_count  integer not null default 0,
  input_tokens     integer not null default 0,
  output_tokens    integer not null default 0,
  cancel_requested boolean not null default false,
  error            text,
  error_code       text,
  result           jsonb,
  started_at       timestamptz,
  heartbeat_at     timestamptz,
  completed_at     timestamptz,
  duration_ms      integer,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists investigations_incident_idx on public.investigations (incident_id, created_at desc);
create index if not exists investigations_user_created_idx on public.investigations (user_id, created_at desc);
create index if not exists investigations_status_idx on public.investigations (status) where status in ('queued', 'running');
drop trigger if exists investigations_touch on public.investigations;
create trigger investigations_touch before update on public.investigations
  for each row execute function public.ii_touch_updated_at();

-- Investigation steps (timeline + every tool call) ----------------------------
create table if not exists public.investigation_steps (
  id                bigint generated always as identity primary key,
  investigation_id  uuid not null references public.investigations (id) on delete cascade,
  user_id           uuid not null references public.profiles (id) on delete cascade,
  seq               integer not null,
  kind              text not null check (kind in ('milestone', 'thought', 'tool_call', 'warning', 'error')),
  status            text not null default 'success' check (status in ('running', 'success', 'error')),
  title             text not null,
  detail            text,
  tool_name         text,
  tool_input        jsonb,
  tool_output       text,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  duration_ms       integer,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (investigation_id, seq)
);
create index if not exists investigation_steps_inv_idx on public.investigation_steps (investigation_id, seq);
drop trigger if exists investigation_steps_touch on public.investigation_steps;
create trigger investigation_steps_touch before update on public.investigation_steps
  for each row execute function public.ii_touch_updated_at();

-- Root cause findings ---------------------------------------------------------
create table if not exists public.root_cause_findings (
  id                  uuid primary key default gen_random_uuid(),
  investigation_id    uuid not null unique references public.investigations (id) on delete cascade,
  user_id             uuid not null references public.profiles (id) on delete cascade,
  root_cause_found    boolean not null,
  summary             text not null,
  root_cause          text not null,
  severity            text not null check (severity in ('critical', 'high', 'medium', 'low')),
  confidence          integer not null check (confidence between 0 and 100),
  affected_service    text,
  affected_endpoint   text,
  evidence            jsonb not null default '[]'::jsonb,
  affected_files      jsonb not null default '[]'::jsonb,
  call_chain          jsonb not null default '[]'::jsonb,
  code_references     jsonb not null default '[]'::jsonb,
  tests_to_add        jsonb not null default '[]'::jsonb,
  suggested_fix       text,
  risk                text,
  recommended_action  text,
  created_at          timestamptz not null default now()
);

-- Suggested fixes -------------------------------------------------------------
create table if not exists public.suggested_fixes (
  id                uuid primary key default gen_random_uuid(),
  investigation_id  uuid not null references public.investigations (id) on delete cascade,
  user_id           uuid not null references public.profiles (id) on delete cascade,
  description       text not null,
  -- [{path, kind: 'fix'|'test', original, updated, diff}]
  changes           jsonb not null default '[]'::jsonb,
  status            text not null default 'proposed' check (status in ('proposed', 'verified', 'failed_verification', 'applied', 'rejected')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists suggested_fixes_inv_idx on public.suggested_fixes (investigation_id, created_at desc);
drop trigger if exists suggested_fixes_touch on public.suggested_fixes;
create trigger suggested_fixes_touch before update on public.suggested_fixes
  for each row execute function public.ii_touch_updated_at();

-- Test results ----------------------------------------------------------------
create table if not exists public.test_results (
  id                uuid primary key default gen_random_uuid(),
  investigation_id  uuid not null references public.investigations (id) on delete cascade,
  fix_id            uuid references public.suggested_fixes (id) on delete set null,
  user_id           uuid not null references public.profiles (id) on delete cascade,
  command           text not null,
  status            text not null check (status in ('passed', 'failed', 'error', 'skipped')),
  exit_code         integer,
  output            text,
  duration_ms       integer,
  created_at        timestamptz not null default now()
);
create index if not exists test_results_inv_idx on public.test_results (investigation_id, created_at desc);

-- Pull requests ---------------------------------------------------------------
create table if not exists public.pull_requests (
  id                uuid primary key default gen_random_uuid(),
  investigation_id  uuid not null references public.investigations (id) on delete cascade,
  fix_id            uuid references public.suggested_fixes (id) on delete set null,
  repository_id     uuid references public.repositories (id) on delete set null,
  user_id           uuid not null references public.profiles (id) on delete cascade,
  status            text not null check (status in ('creating', 'open', 'failed')),
  trigger           text not null default 'manual' check (trigger in ('manual', 'auto')),
  branch            text,
  base_branch       text,
  number            integer,
  url               text,
  title             text,
  error             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists pull_requests_inv_idx on public.pull_requests (investigation_id, created_at desc);
drop trigger if exists pull_requests_touch on public.pull_requests;
create trigger pull_requests_touch before update on public.pull_requests
  for each row execute function public.ii_touch_updated_at();

-- Row Level Security ----------------------------------------------------------
-- Users only see and change their own rows. The investigation runner uses the
-- server-only secret key (bypasses RLS) and always writes user_id explicitly.
do $$
declare
  t text;
begin
  foreach t in array array[
    'repositories', 'incidents', 'incident_logs', 'investigations', 'investigation_steps',
    'root_cause_findings', 'suggested_fixes', 'test_results', 'pull_requests'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows: select" on public.%I', t);
    execute format('create policy "own rows: select" on public.%I for select to authenticated using (user_id = auth.uid())', t);
  end loop;

  -- Direct writes from the user's session are limited to the tables a user
  -- edits; investigation output is written only by the server runner.
  foreach t in array array['repositories', 'incidents', 'incident_logs'] loop
    execute format('drop policy if exists "own rows: insert" on public.%I', t);
    execute format('create policy "own rows: insert" on public.%I for insert to authenticated with check (user_id = auth.uid())', t);
    execute format('drop policy if exists "own rows: update" on public.%I', t);
    execute format('create policy "own rows: update" on public.%I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('drop policy if exists "own rows: delete" on public.%I', t);
    execute format('create policy "own rows: delete" on public.%I for delete to authenticated using (user_id = auth.uid())', t);
  end loop;
end $$;

-- Incidents may only reference the caller's own repositories.
create or replace function public.ii_check_incident_repository()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.repository_id is not null and not exists (
    select 1 from public.repositories r where r.id = new.repository_id and r.user_id = new.user_id
  ) then
    raise exception 'repository does not belong to this user' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists incidents_check_repository on public.incidents;
create trigger incidents_check_repository before insert or update of repository_id on public.incidents
  for each row execute function public.ii_check_incident_repository();
