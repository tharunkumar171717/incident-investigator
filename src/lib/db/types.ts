// Row shapes for the tables in supabase/migrations. Kept by hand so the app
// does not depend on the Supabase CLI for type generation.

export type Severity = "critical" | "high" | "medium" | "low";
export type IncidentStatus = "open" | "investigating" | "root_cause_identified" | "fix_proposed" | "resolved" | "closed";
export type InvestigationStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type InvestigationOutcome = "root_cause_found" | "inconclusive" | "error";
export type StepKind = "milestone" | "thought" | "tool_call" | "warning" | "error";
export type StepStatus = "running" | "success" | "error";

export interface RepositoryRow {
  id: string;
  user_id: string;
  provider: "github";
  owner: string;
  name: string;
  full_name: string;
  default_branch: string;
  html_url: string | null;
  description: string | null;
  language: string | null;
  is_private: boolean;
  can_push: boolean;
  test_command: string | null;
  setup_command: string | null;
  metadata: Record<string, unknown>;
  last_verified_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface IncidentRow {
  id: string;
  user_id: string;
  repository_id: string | null;
  title: string;
  description: string | null;
  endpoint: string | null;
  error_message: string | null;
  stack_trace: string | null;
  additional_context: string | null;
  branch: string | null;
  commit_sha: string | null;
  auto_fix: boolean;
  severity: Severity | null;
  status: IncidentStatus;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface IncidentLogRow {
  id: number;
  incident_id: string;
  user_id: string;
  line_no: number;
  level: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | null;
  message: string;
  source: string | null;
  logged_at: string | null;
  created_at: string;
}

export interface InvestigationRow {
  id: string;
  incident_id: string;
  user_id: string;
  repository_id: string | null;
  status: InvestigationStatus;
  outcome: InvestigationOutcome | null;
  provider: string;
  model: string;
  ref: string | null;
  commit_sha: string | null;
  step_count: number;
  tool_call_count: number;
  input_tokens: number;
  output_tokens: number;
  cancel_requested: boolean;
  error: string | null;
  error_code: string | null;
  result: InvestigationReport | null;
  started_at: string | null;
  heartbeat_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  created_at: string;
  updated_at: string;
}

export interface InvestigationStepRow {
  id: number;
  investigation_id: string;
  user_id: string;
  seq: number;
  kind: StepKind;
  status: StepStatus;
  title: string;
  detail: string | null;
  tool_name: string | null;
  tool_input: Record<string, unknown> | null;
  tool_output: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
}

export interface EvidenceItem {
  type: "stack_trace" | "log" | "code" | "commit" | "endpoint" | "other";
  description: string;
  source: string;
}

export interface CodeReference {
  path: string;
  start_line: number;
  end_line: number;
  highlight_lines: number[];
  explanation: string;
  /** Filled in by the server from the repository snapshot, never by the model. */
  code?: string;
  language?: string;
  missing?: boolean;
}

export interface InvestigationReport {
  root_cause_found: boolean;
  summary: string;
  severity: Severity;
  confidence: number;
  affected_service: string;
  affected_endpoint: string;
  root_cause: string;
  evidence: EvidenceItem[];
  affected_files: string[];
  call_chain: string[];
  code_references: CodeReference[];
  suggested_fix: string;
  tests_to_add: string[];
  risk: string;
  recommended_action: string;
}

export interface RootCauseFindingRow extends Omit<InvestigationReport, "suggested_fix"> {
  id: string;
  investigation_id: string;
  user_id: string;
  suggested_fix: string | null;
  created_at: string;
}

export interface FileChange {
  path: string;
  kind: "fix" | "test";
  /** null when the file is new. */
  original: string | null;
  updated: string;
  diff: string;
}

export interface SuggestedFixRow {
  id: string;
  investigation_id: string;
  user_id: string;
  description: string;
  changes: FileChange[];
  status: "proposed" | "verified" | "failed_verification" | "applied" | "rejected";
  created_at: string;
  updated_at: string;
}

export interface TestResultRow {
  id: string;
  investigation_id: string;
  fix_id: string | null;
  user_id: string;
  command: string;
  status: "passed" | "failed" | "error" | "skipped";
  exit_code: number | null;
  output: string | null;
  duration_ms: number | null;
  created_at: string;
}

export interface PullRequestRow {
  id: string;
  investigation_id: string;
  fix_id: string | null;
  repository_id: string | null;
  user_id: string;
  status: "creating" | "open" | "failed";
  trigger: "manual" | "auto";
  branch: string | null;
  base_branch: string | null;
  number: number | null;
  url: string | null;
  title: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}
