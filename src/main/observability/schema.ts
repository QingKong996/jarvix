import type { DatabaseSync } from "node:sqlite";

export const AGENT_DATABASE_VERSION = 2;

export const AGENT_SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  app_instance_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  run_type TEXT NOT NULL CHECK (run_type IN ('prompt', 'naming')),
  provider TEXT,
  model TEXT,
  permission TEXT,
  started_at_ms INTEGER NOT NULL,
  ended_at_ms INTEGER,
  last_heartbeat_ms INTEGER NOT NULL,
  duration_ms INTEGER,
  active_duration_ms INTEGER,
  outcome TEXT NOT NULL CHECK (
    outcome IN ('running', 'completed', 'failed', 'aborted', 'max_rounds', 'crashed')
  ),
  error_stage TEXT,
  error_code TEXT,
  error_message TEXT,
  prompt_chars INTEGER,
  prompt_hash TEXT,
  history_messages_at_start INTEGER,
  context_window INTEGER,
  context_tokens_start INTEGER,
  context_tokens_end INTEGER,
  context_utilization_end REAL,
  llm_turns INTEGER NOT NULL DEFAULT 0,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  agent_steps INTEGER NOT NULL DEFAULT 0,
  max_rounds INTEGER,
  max_rounds_hit INTEGER NOT NULL DEFAULT 0 CHECK (max_rounds_hit IN (0, 1)),
  injected_prompts INTEGER NOT NULL DEFAULT 0,
  tool_errors INTEGER NOT NULL DEFAULT 0,
  repeat_tool_calls INTEGER NOT NULL DEFAULT 0,
  permission_requests INTEGER NOT NULL DEFAULT 0,
  permission_wait_ms INTEGER NOT NULL DEFAULT 0,
  compactions INTEGER NOT NULL DEFAULT 0,
  compaction_duration_ms INTEGER NOT NULL DEFAULT 0,
  compaction_input_tokens INTEGER,
  compaction_output_tokens INTEGER,
  llm_duration_ms INTEGER NOT NULL DEFAULT 0,
  tool_duration_ms INTEGER NOT NULL DEFAULT 0,
  tool_execution_ms INTEGER NOT NULL DEFAULT 0,
  unaccounted_ms INTEGER,
  ttft_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  reasoning_tokens INTEGER,
  cost_usd REAL,
  tokens_per_second REAL,
  wall_tokens_per_second REAL,
  final_stop_reason TEXT,
  tool_sequence_json TEXT CHECK (
    tool_sequence_json IS NULL OR json_valid(tool_sequence_json)
  )
) STRICT;

CREATE TABLE IF NOT EXISTS turns (
  turn_id TEXT PRIMARY KEY,
  app_instance_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  turn_index INTEGER,
  turn_kind TEXT NOT NULL CHECK (turn_kind IN ('main', 'compaction', 'naming')),
  provider TEXT,
  model TEXT,
  started_at_ms INTEGER NOT NULL,
  ended_at_ms INTEGER,
  duration_ms INTEGER,
  outcome TEXT NOT NULL CHECK (outcome IN ('running', 'completed', 'error', 'aborted')),
  ttft_ms INTEGER,
  first_token_kind TEXT CHECK (first_token_kind IN ('text', 'thinking', 'toolCall')),
  generation_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  reasoning_tokens INTEGER,
  cost_usd REAL,
  tokens_per_second REAL,
  wall_tokens_per_second REAL,
  stop_reason TEXT,
  response_id TEXT,
  response_model TEXT,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  message_count INTEGER,
  context_tokens_before INTEGER,
  context_tokens_after INTEGER,
  received_text_chars INTEGER,
  received_thinking_chars INTEGER,
  error_code TEXT,
  error_message TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS tools (
  tool_span_id TEXT PRIMARY KEY,
  app_instance_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  turn_id TEXT REFERENCES turns(turn_id) ON DELETE CASCADE,
  turn_index INTEGER,
  step_index INTEGER NOT NULL,
  tool_call_id TEXT,
  tool_name TEXT NOT NULL,
  tool_category TEXT NOT NULL CHECK (
    tool_category IN ('shell', 'patch', 'image', 'meta', 'other')
  ),
  started_at_ms INTEGER NOT NULL,
  ended_at_ms INTEGER,
  duration_ms INTEGER,
  outcome TEXT NOT NULL CHECK (
    outcome IN ('running', 'success', 'error', 'cancelled')
  ),
  permission_requests INTEGER NOT NULL DEFAULT 0,
  permission_wait_ms INTEGER NOT NULL DEFAULT 0,
  execution_ms INTEGER,
  is_error INTEGER NOT NULL DEFAULT 0 CHECK (is_error IN (0, 1)),
  end_reason TEXT,
  error_code TEXT,
  error_message TEXT,
  args_bytes INTEGER,
  args_hash TEXT,
  output_chars INTEGER,
  output_bytes INTEGER,
  truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0, 1)),
  image_count INTEGER NOT NULL DEFAULT 0,
  repeat_index INTEGER NOT NULL DEFAULT 0,
  repeat_group_size INTEGER NOT NULL DEFAULT 1,
  detail_json TEXT CHECK (detail_json IS NULL OR json_valid(detail_json)),
  UNIQUE (run_id, step_index)
) STRICT;

CREATE TABLE IF NOT EXISTS events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_instance_id TEXT NOT NULL,
  session_id TEXT,
  run_id TEXT,
  turn_id TEXT,
  tool_span_id TEXT,
  ts_ms INTEGER NOT NULL,
  event TEXT NOT NULL,
  detail_json TEXT CHECK (detail_json IS NULL OR json_valid(detail_json))
) STRICT;

CREATE INDEX IF NOT EXISTS idx_runs_started
  ON runs(started_at_ms);
CREATE INDEX IF NOT EXISTS idx_runs_session
  ON runs(session_id, started_at_ms);
CREATE INDEX IF NOT EXISTS idx_runs_model
  ON runs(provider, model, started_at_ms);
CREATE INDEX IF NOT EXISTS idx_runs_outcome
  ON runs(outcome, started_at_ms);
CREATE INDEX IF NOT EXISTS idx_runs_active
  ON runs(outcome, last_heartbeat_ms);
CREATE INDEX IF NOT EXISTS idx_turns_run
  ON turns(run_id, turn_kind, turn_index);
CREATE INDEX IF NOT EXISTS idx_turns_model
  ON turns(provider, model, turn_kind, started_at_ms);
CREATE UNIQUE INDEX IF NOT EXISTS idx_turns_main_index
  ON turns(run_id, turn_index)
  WHERE turn_kind = 'main';
CREATE INDEX IF NOT EXISTS idx_tools_run
  ON tools(run_id, step_index);
CREATE INDEX IF NOT EXISTS idx_tools_turn
  ON tools(turn_id, step_index);
CREATE INDEX IF NOT EXISTS idx_tools_name
  ON tools(tool_name, started_at_ms);
CREATE INDEX IF NOT EXISTS idx_tools_outcome
  ON tools(outcome, started_at_ms);
CREATE INDEX IF NOT EXISTS idx_events_run
  ON events(run_id, ts_ms);
CREATE INDEX IF NOT EXISTS idx_events_event
  ON events(event, ts_ms);
`;

const MIGRATION_V1_TO_V2 = `
ALTER TABLE runs ADD COLUMN app_version TEXT;
ALTER TABLE runs ADD COLUMN build_id TEXT;
ALTER TABLE runs ADD COLUMN reasoning_level TEXT;
ALTER TABLE runs ADD COLUMN system_prompt_hash TEXT;
ALTER TABLE runs ADD COLUMN toolset_hash TEXT;
ALTER TABLE runs ADD COLUMN tool_count INTEGER;
ALTER TABLE runs ADD COLUMN submit_to_first_token_ms INTEGER;
ALTER TABLE runs ADD COLUMN llm_http_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN llm_retries INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN rate_limit_responses INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN retry_after_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN provider_http_status INTEGER;

ALTER TABLE turns ADD COLUMN llm_http_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE turns ADD COLUMN llm_retries INTEGER NOT NULL DEFAULT 0;
ALTER TABLE turns ADD COLUMN rate_limit_responses INTEGER NOT NULL DEFAULT 0;
ALTER TABLE turns ADD COLUMN retry_after_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE turns ADD COLUMN provider_http_status INTEGER;

`;

export function migrateAgentDatabase(database: DatabaseSync): void {
  const row = database.prepare("PRAGMA user_version").get();
  const version = Number(row?.user_version ?? 0);

  if (version === 0 || version === 1) {
    database.exec("BEGIN IMMEDIATE");
    try {
      if (version === 0) {
        database.exec(AGENT_SCHEMA_V1);
      }
      database.exec(MIGRATION_V1_TO_V2);
      database.exec(`PRAGMA user_version = ${AGENT_DATABASE_VERSION}`);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return;
  }

  if (version !== AGENT_DATABASE_VERSION) {
    throw new Error(`Unsupported observability database version: ${version}`);
  }
}
