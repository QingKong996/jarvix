import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { type JarvixLogger, noopLogger } from "../../core/logger.ts";
import {
    noopAgentObserver,
    type AgentEvent,
    type AgentObserver,
    type AgentObserverStats,
    type AgentRunFinished,
    type AgentRunStarted,
    type AgentToolFinished,
    type AgentToolStarted,
    type AgentTurnFinished,
    type AgentTurnStarted
} from "../../core/observability/index.ts";
import { AGENT_DATABASE_VERSION, migrateAgentDatabase } from "./schema.ts";

const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_MAX_BYTES = 200 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
const ERROR_MESSAGE_MAX_LENGTH = 500;

const SQL = {
    insertRun: `
        INSERT INTO runs (
            run_id, app_instance_id, session_id, run_type, provider, model,
            permission, started_at_ms, last_heartbeat_ms, outcome, prompt_chars,
            prompt_hash, history_messages_at_start, context_window,
            context_tokens_start, max_rounds
        ) VALUES (
            :run_id, :app_instance_id, :session_id, :run_type, :provider, :model,
            :permission, :started_at_ms, :last_heartbeat_ms, 'running',
            :prompt_chars, :prompt_hash, :history_messages_at_start,
            :context_window, :context_tokens_start, :max_rounds
        )
        ON CONFLICT(run_id) DO UPDATE SET
            provider = COALESCE(excluded.provider, runs.provider),
            model = COALESCE(excluded.model, runs.model),
            permission = COALESCE(excluded.permission, runs.permission),
            prompt_chars = COALESCE(excluded.prompt_chars, runs.prompt_chars),
            prompt_hash = COALESCE(excluded.prompt_hash, runs.prompt_hash),
            history_messages_at_start = COALESCE(
                excluded.history_messages_at_start,
                runs.history_messages_at_start
            ),
            context_window = COALESCE(excluded.context_window, runs.context_window),
            context_tokens_start = COALESCE(
                excluded.context_tokens_start,
                runs.context_tokens_start
            ),
            max_rounds = COALESCE(excluded.max_rounds, runs.max_rounds),
            last_heartbeat_ms = MAX(
                runs.last_heartbeat_ms,
                excluded.last_heartbeat_ms
            )
    `,
    updateRun: `
        UPDATE runs SET
            ended_at_ms = :ended_at_ms,
            last_heartbeat_ms = :last_heartbeat_ms,
            duration_ms = :duration_ms,
            active_duration_ms = :active_duration_ms,
            outcome = :outcome,
            provider = COALESCE(:provider, provider),
            model = COALESCE(:model, model),
            error_stage = COALESCE(:error_stage, error_stage),
            error_code = COALESCE(:error_code, error_code),
            error_message = COALESCE(:error_message, error_message),
            context_tokens_end = COALESCE(:context_tokens_end, context_tokens_end),
            context_utilization_end = COALESCE(
                :context_utilization_end,
                context_utilization_end
            ),
            llm_turns = :llm_turns,
            tool_calls = :tool_calls,
            agent_steps = :agent_steps,
            max_rounds_hit = :max_rounds_hit,
            injected_prompts = :injected_prompts,
            tool_errors = :tool_errors,
            repeat_tool_calls = :repeat_tool_calls,
            permission_requests = :permission_requests,
            permission_wait_ms = :permission_wait_ms,
            compactions = :compactions,
            compaction_duration_ms = :compaction_duration_ms,
            compaction_input_tokens = COALESCE(
                :compaction_input_tokens,
                compaction_input_tokens
            ),
            compaction_output_tokens = COALESCE(
                :compaction_output_tokens,
                compaction_output_tokens
            ),
            llm_duration_ms = :llm_duration_ms,
            tool_duration_ms = :tool_duration_ms,
            tool_execution_ms = :tool_execution_ms,
            unaccounted_ms = COALESCE(:unaccounted_ms, unaccounted_ms),
            ttft_ms = COALESCE(:ttft_ms, ttft_ms),
            input_tokens = COALESCE(:input_tokens, input_tokens),
            output_tokens = COALESCE(:output_tokens, output_tokens),
            cache_read_tokens = COALESCE(:cache_read_tokens, cache_read_tokens),
            cache_write_tokens = COALESCE(:cache_write_tokens, cache_write_tokens),
            reasoning_tokens = COALESCE(:reasoning_tokens, reasoning_tokens),
            cost_usd = COALESCE(:cost_usd, cost_usd),
            tokens_per_second = COALESCE(:tokens_per_second, tokens_per_second),
            wall_tokens_per_second = COALESCE(
                :wall_tokens_per_second,
                wall_tokens_per_second
            ),
            final_stop_reason = COALESCE(:final_stop_reason, final_stop_reason),
            tool_sequence_json = COALESCE(:tool_sequence_json, tool_sequence_json)
        WHERE run_id = :run_id
    `,
    insertTurn: `
        INSERT INTO turns (
            turn_id, app_instance_id, session_id, run_id, turn_index, turn_kind,
            provider, model, started_at_ms, outcome, message_count,
            context_tokens_before
        ) VALUES (
            :turn_id, :app_instance_id, :session_id, :run_id, :turn_index,
            :turn_kind, :provider, :model, :started_at_ms, 'running',
            :message_count, :context_tokens_before
        )
        ON CONFLICT(turn_id) DO UPDATE SET
            turn_index = COALESCE(excluded.turn_index, turns.turn_index),
            provider = COALESCE(excluded.provider, turns.provider),
            model = COALESCE(excluded.model, turns.model),
            message_count = COALESCE(excluded.message_count, turns.message_count),
            context_tokens_before = COALESCE(
                excluded.context_tokens_before,
                turns.context_tokens_before
            )
    `,
    updateTurn: `
        UPDATE turns SET
            ended_at_ms = :ended_at_ms,
            duration_ms = :duration_ms,
            outcome = :outcome,
            ttft_ms = COALESCE(:ttft_ms, ttft_ms),
            first_token_kind = COALESCE(:first_token_kind, first_token_kind),
            generation_ms = COALESCE(:generation_ms, generation_ms),
            input_tokens = COALESCE(:input_tokens, input_tokens),
            output_tokens = COALESCE(:output_tokens, output_tokens),
            cache_read_tokens = COALESCE(:cache_read_tokens, cache_read_tokens),
            cache_write_tokens = COALESCE(:cache_write_tokens, cache_write_tokens),
            reasoning_tokens = COALESCE(:reasoning_tokens, reasoning_tokens),
            cost_usd = COALESCE(:cost_usd, cost_usd),
            tokens_per_second = COALESCE(:tokens_per_second, tokens_per_second),
            wall_tokens_per_second = COALESCE(
                :wall_tokens_per_second,
                wall_tokens_per_second
            ),
            stop_reason = COALESCE(:stop_reason, stop_reason),
            response_id = COALESCE(:response_id, response_id),
            response_model = COALESCE(:response_model, response_model),
            tool_calls = :tool_calls,
            context_tokens_after = COALESCE(
                :context_tokens_after,
                context_tokens_after
            ),
            received_text_chars = COALESCE(
                :received_text_chars,
                received_text_chars
            ),
            received_thinking_chars = COALESCE(
                :received_thinking_chars,
                received_thinking_chars
            ),
            error_code = COALESCE(:error_code, error_code),
            error_message = COALESCE(:error_message, error_message)
        WHERE turn_id = :turn_id
    `,
    insertTool: `
        INSERT INTO tools (
            tool_span_id, app_instance_id, session_id, run_id, turn_id,
            turn_index, step_index, tool_call_id, tool_name, tool_category,
            started_at_ms, outcome, args_bytes, args_hash, detail_json
        ) VALUES (
            :tool_span_id, :app_instance_id, :session_id, :run_id, :turn_id,
            :turn_index, :step_index, :tool_call_id, :tool_name, :tool_category,
            :started_at_ms, 'running', :args_bytes, :args_hash, :detail_json
        )
        ON CONFLICT(tool_span_id) DO UPDATE SET
            turn_id = COALESCE(excluded.turn_id, tools.turn_id),
            turn_index = COALESCE(excluded.turn_index, tools.turn_index),
            step_index = excluded.step_index,
            tool_call_id = COALESCE(excluded.tool_call_id, tools.tool_call_id),
            tool_name = excluded.tool_name,
            tool_category = excluded.tool_category,
            args_bytes = COALESCE(excluded.args_bytes, tools.args_bytes),
            args_hash = COALESCE(excluded.args_hash, tools.args_hash),
            detail_json = COALESCE(excluded.detail_json, tools.detail_json)
    `,
    updateTool: `
        UPDATE tools SET
            ended_at_ms = :ended_at_ms,
            duration_ms = :duration_ms,
            outcome = :outcome,
            permission_requests = :permission_requests,
            permission_wait_ms = :permission_wait_ms,
            execution_ms = :execution_ms,
            is_error = :is_error,
            end_reason = COALESCE(:end_reason, end_reason),
            error_code = COALESCE(:error_code, error_code),
            error_message = COALESCE(:error_message, error_message),
            output_chars = COALESCE(:output_chars, output_chars),
            output_bytes = COALESCE(:output_bytes, output_bytes),
            truncated = :truncated,
            image_count = :image_count,
            repeat_index = :repeat_index,
            repeat_group_size = :repeat_group_size,
            detail_json = COALESCE(:detail_json, detail_json)
        WHERE tool_span_id = :tool_span_id
    `,
    updateHeartbeat: `
        UPDATE runs
        SET last_heartbeat_ms = MAX(last_heartbeat_ms, :ts_ms)
        WHERE run_id = :run_id
    `,
    insertEvent: `
        INSERT INTO events (
            app_instance_id, session_id, run_id, turn_id, tool_span_id,
            ts_ms, event, detail_json
        ) VALUES (
            :app_instance_id, :session_id, :run_id, :turn_id, :tool_span_id,
            :ts_ms, :event, :detail_json
        )
    `,
    upsertMeta: `
        INSERT INTO meta (key, value) VALUES (:key, :value)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `,
    insertCreatedMeta: `
        INSERT INTO meta (key, value) VALUES ('created_at_ms', :value)
        ON CONFLICT(key) DO NOTHING
    `,
    selectRunningRuns: `
        SELECT run_id, app_instance_id, session_id, started_at_ms, last_heartbeat_ms
        FROM runs
        WHERE outcome = 'running'
    `,
    recoverTurn: `
        UPDATE turns SET
            ended_at_ms = :now,
            duration_ms = MAX(0, :now - started_at_ms),
            outcome = 'error',
            error_code = 'app_crashed',
            error_message = 'Jarvix exited before this turn completed.'
        WHERE outcome = 'running'
    `,
    recoverTool: `
        UPDATE tools SET
            ended_at_ms = :now,
            duration_ms = MAX(0, :now - started_at_ms),
            outcome = 'error',
            execution_ms = MAX(0, :now - started_at_ms - permission_wait_ms),
            error_code = 'app_crashed',
            error_message = 'Jarvix exited before this tool call completed.'
        WHERE outcome = 'running'
    `,
    recoverRun: `
        UPDATE runs SET
            ended_at_ms = :now,
            last_heartbeat_ms = :now,
            duration_ms = MAX(0, :now - started_at_ms),
            outcome = 'crashed',
            error_stage = 'runtime',
            error_code = 'app_crashed',
            error_message = 'Jarvix exited before this run completed.'
        WHERE run_id = :run_id AND outcome = 'running'
    `,
    pruneRuns: `
        DELETE FROM runs
        WHERE outcome != 'running' AND started_at_ms < :cutoff
    `,
    pruneEvents: `
        DELETE FROM events
        WHERE ts_ms < :cutoff
    `,
    countFinishedRuns: `
        SELECT count(*) AS count FROM runs WHERE outcome != 'running'
    `,
    deleteOldestRuns: `
        DELETE FROM runs
        WHERE run_id IN (
            SELECT run_id FROM runs
            WHERE outcome != 'running'
            ORDER BY started_at_ms ASC
            LIMIT :count
        )
    `
} as const;

type SqlParameter = string | number | bigint | null | Uint8Array;

type RunningRunRow = {
    run_id: string;
    app_instance_id: string;
    session_id: string;
    started_at_ms: number;
    last_heartbeat_ms: number;
};

export type SqliteObserverOptions = {
    databasePath: string;
    appVersion: string;
    appInstanceId?: string;
    logger?: JarvixLogger;
    now?: () => number;
    retentionDays?: number;
    maxBytes?: number;
};

export class SqliteAgentObserver implements AgentObserver {
    private readonly database: DatabaseSync;
    private readonly databasePath: string;
    private readonly appInstanceId: string;
    private readonly logger: JarvixLogger;
    private readonly now: () => number;
    private readonly retentionDays: number;
    private readonly maxBytes: number;
    private readonly statements = new Map<string, StatementSync>();
    private readonly maintenanceTimer: ReturnType<typeof setInterval>;
    private closed = false;
    private writeErrors = 0;
    private droppedWrites = 0;
    private lastWarningAt = 0;

    constructor(options: SqliteObserverOptions) {
        this.databasePath = options.databasePath;
        this.appInstanceId = options.appInstanceId ?? randomUUID();
        this.logger = options.logger ?? noopLogger;
        this.now = options.now ?? Date.now;
        this.retentionDays = Math.max(0, options.retentionDays ?? DEFAULT_RETENTION_DAYS);
        this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

        if (this.databasePath !== ":memory:") {
            mkdirSync(dirname(this.databasePath), { recursive: true, mode: 0o700 });
        }

        this.database = new DatabaseSync(this.databasePath, {
            enableForeignKeyConstraints: true
        });
        if (this.databasePath !== ":memory:") {
            try {
                chmodSync(this.databasePath, 0o600);
            } catch {
                // Best effort on platforms that do not support POSIX modes.
            }
        }

        this.database.exec(`
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA foreign_keys = ON;
            PRAGMA busy_timeout = 1000;
            PRAGMA temp_store = MEMORY;
            PRAGMA auto_vacuum = INCREMENTAL;
        `);
        migrateAgentDatabase(this.database);
        this.writeMeta(options.appVersion);
        this.maintain(true);
        this.maintenanceTimer = setInterval(() => this.maintain(false), DAY_MS);
        this.maintenanceTimer.unref?.();
    }

    runStarted(run: AgentRunStarted): void {
        this.write("run.started", SQL.insertRun, {
            run_id: run.runId,
            app_instance_id: this.appInstanceId,
            session_id: run.sessionId,
            run_type: run.runType,
            provider: nullable(run.provider),
            model: nullable(run.model),
            permission: nullable(run.permission),
            started_at_ms: Math.round(run.startedAtMs),
            last_heartbeat_ms: Math.round(run.lastHeartbeatMs ?? run.startedAtMs),
            prompt_chars: nullableInteger(run.promptChars),
            prompt_hash: nullable(run.promptHash),
            history_messages_at_start: nullableInteger(run.historyMessagesAtStart),
            context_window: nullableInteger(run.contextWindow),
            context_tokens_start: nullableInteger(run.contextTokensStart),
            max_rounds: nullableInteger(run.maxRounds)
        });
    }

    runFinished(runId: string, run: AgentRunFinished): void {
        const permissionWaitMs = run.permissionWaitMs ?? 0;
        this.write("run.finished", SQL.updateRun, {
            run_id: runId,
            ended_at_ms: Math.round(run.endedAtMs),
            last_heartbeat_ms: Math.round(run.lastHeartbeatMs ?? run.endedAtMs),
            duration_ms: Math.round(run.durationMs),
            active_duration_ms: run.activeDurationMs !== undefined
                ? Math.round(run.activeDurationMs)
                : Math.round(Math.max(0, run.durationMs - permissionWaitMs)),
            outcome: run.outcome,
            provider: nullable(run.provider),
            model: nullable(run.model),
            error_stage: nullable(run.errorStage),
            error_code: nullable(run.errorCode),
            error_message: sanitizeError(run.errorMessage),
            context_tokens_end: nullableInteger(run.contextTokensEnd),
            context_utilization_end: nullableNumber(run.contextUtilizationEnd),
            llm_turns: run.llmTurns,
            tool_calls: run.toolCalls,
            agent_steps: run.agentSteps,
            max_rounds_hit: toInteger(run.maxRoundsHit),
            injected_prompts: run.injectedPrompts ?? 0,
            tool_errors: run.toolErrors ?? 0,
            repeat_tool_calls: run.repeatToolCalls ?? 0,
            permission_requests: run.permissionRequests ?? 0,
            permission_wait_ms: Math.round(permissionWaitMs),
            compactions: run.compactions ?? 0,
            compaction_duration_ms: Math.round(run.compactionDurationMs ?? 0),
            compaction_input_tokens: nullableInteger(run.compactionInputTokens),
            compaction_output_tokens: nullableInteger(run.compactionOutputTokens),
            llm_duration_ms: Math.round(run.llmDurationMs ?? 0),
            tool_duration_ms: Math.round(run.toolDurationMs ?? 0),
            tool_execution_ms: Math.round(run.toolExecutionMs ?? 0),
            unaccounted_ms: nullableInteger(run.unaccountedMs),
            ttft_ms: nullableInteger(run.ttftMs),
            input_tokens: nullableInteger(run.inputTokens),
            output_tokens: nullableInteger(run.outputTokens),
            cache_read_tokens: nullableInteger(run.cacheReadTokens),
            cache_write_tokens: nullableInteger(run.cacheWriteTokens),
            reasoning_tokens: nullableInteger(run.reasoningTokens),
            cost_usd: nullableNumber(run.costUsd),
            tokens_per_second: nullableNumber(run.tokensPerSecond),
            wall_tokens_per_second: nullableNumber(run.wallTokensPerSecond),
            final_stop_reason: nullable(run.finalStopReason),
            tool_sequence_json: jsonText(run.toolSequenceJson)
        });
    }

    turnStarted(turn: AgentTurnStarted): void {
        this.write("turn.started", SQL.insertTurn, {
            turn_id: turn.turnId,
            app_instance_id: this.appInstanceId,
            session_id: turn.sessionId,
            run_id: turn.runId,
            turn_index: nullableInteger(turn.turnIndex),
            turn_kind: turn.turnKind,
            provider: nullable(turn.provider),
            model: nullable(turn.model),
            started_at_ms: Math.round(turn.startedAtMs),
            message_count: nullableInteger(turn.messageCount),
            context_tokens_before: nullableInteger(turn.contextTokensBefore)
        });
    }

    turnFinished(turnId: string, turn: AgentTurnFinished): void {
        this.write("turn.finished", SQL.updateTurn, {
            turn_id: turnId,
            ended_at_ms: Math.round(turn.endedAtMs),
            duration_ms: Math.round(turn.durationMs),
            outcome: turn.outcome,
            ttft_ms: nullableInteger(turn.ttftMs),
            first_token_kind: nullable(turn.firstTokenKind),
            generation_ms: nullableInteger(turn.generationMs),
            input_tokens: nullableInteger(turn.inputTokens),
            output_tokens: nullableInteger(turn.outputTokens),
            cache_read_tokens: nullableInteger(turn.cacheReadTokens),
            cache_write_tokens: nullableInteger(turn.cacheWriteTokens),
            reasoning_tokens: nullableInteger(turn.reasoningTokens),
            cost_usd: nullableNumber(turn.costUsd),
            tokens_per_second: nullableNumber(turn.tokensPerSecond),
            wall_tokens_per_second: nullableNumber(turn.wallTokensPerSecond),
            stop_reason: nullable(turn.stopReason),
            response_id: nullable(turn.responseId),
            response_model: nullable(turn.responseModel),
            tool_calls: turn.toolCalls ?? 0,
            context_tokens_after: nullableInteger(turn.contextTokensAfter),
            received_text_chars: nullableInteger(turn.receivedTextChars),
            received_thinking_chars: nullableInteger(turn.receivedThinkingChars),
            error_code: nullable(turn.errorCode),
            error_message: sanitizeError(turn.errorMessage)
        });
    }

    toolStarted(tool: AgentToolStarted): void {
        this.write("tool.started", SQL.insertTool, {
            tool_span_id: tool.toolSpanId,
            app_instance_id: this.appInstanceId,
            session_id: tool.sessionId,
            run_id: tool.runId,
            turn_id: nullable(tool.turnId),
            turn_index: nullableInteger(tool.turnIndex),
            step_index: Math.round(tool.stepIndex),
            tool_call_id: nullable(tool.toolCallId),
            tool_name: tool.toolName,
            tool_category: tool.toolCategory,
            started_at_ms: Math.round(tool.startedAtMs),
            args_bytes: nullableInteger(tool.argsBytes),
            args_hash: nullable(tool.argsHash),
            detail_json: jsonDetail(tool.detail)
        });
    }

    toolFinished(toolSpanId: string, tool: AgentToolFinished): void {
        const permissionWaitMs = tool.permissionWaitMs ?? 0;
        this.write("tool.finished", SQL.updateTool, {
            tool_span_id: toolSpanId,
            ended_at_ms: Math.round(tool.endedAtMs),
            duration_ms: Math.round(tool.durationMs),
            outcome: tool.outcome,
            permission_requests: tool.permissionRequests ?? 0,
            permission_wait_ms: Math.round(permissionWaitMs),
            execution_ms: tool.executionMs !== undefined
                ? Math.round(tool.executionMs)
                : Math.round(Math.max(0, tool.durationMs - permissionWaitMs)),
            is_error: toInteger(tool.isError),
            end_reason: nullable(tool.endReason),
            error_code: nullable(tool.errorCode),
            error_message: sanitizeError(tool.errorMessage),
            output_chars: nullableInteger(tool.outputChars),
            output_bytes: nullableInteger(tool.outputBytes),
            truncated: toInteger(tool.truncated),
            image_count: Math.round(tool.imageCount ?? 0),
            repeat_index: Math.round(tool.repeatIndex ?? 0),
            repeat_group_size: Math.round(tool.repeatGroupSize ?? 1),
            detail_json: jsonDetail(tool.detail)
        });
    }

    heartbeat(runId: string, tsMs: number): void {
        this.write("run.heartbeat", SQL.updateHeartbeat, {
            run_id: runId,
            ts_ms: Math.round(tsMs)
        });
    }

    event(event: AgentEvent): void {
        this.write("event", SQL.insertEvent, {
            app_instance_id: this.appInstanceId,
            session_id: nullable(event.sessionId),
            run_id: nullable(event.runId),
            turn_id: nullable(event.turnId),
            tool_span_id: nullable(event.toolSpanId),
            ts_ms: Math.round(event.tsMs),
            event: event.event,
            detail_json: jsonDetail(event.detail)
        });
    }

    flush(_timeoutMs?: number): Promise<void> {
        return Promise.resolve();
    }

    close(): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        clearInterval(this.maintenanceTimer);
        this.statements.clear();
        try {
            this.database.close();
        } catch (error) {
            this.recordFailure("close", error);
        }
    }

    stats(): AgentObserverStats {
        return {
            writeErrors: this.writeErrors,
            droppedWrites: this.droppedWrites
        };
    }

    private writeMeta(appVersion: string): void {
        this.statement(SQL.upsertMeta).run({
            key: "schema_version",
            value: String(AGENT_DATABASE_VERSION)
        });
        this.statement(SQL.upsertMeta).run({
            key: "app_version",
            value: appVersion
        });
        this.statement(SQL.insertCreatedMeta).run({
            value: String(this.now())
        });
    }

    private maintain(recoverInterrupted: boolean): void {
        try {
            const now = this.now();
            const cutoff = now - this.retentionDays * DAY_MS;
            const running = recoverInterrupted
                ? this.statement(SQL.selectRunningRuns).all() as unknown as RunningRunRow[]
                : [];
            let deleted = 0;

            this.database.exec("BEGIN IMMEDIATE");
            try {
                if (recoverInterrupted) {
                    for (const run of running) {
                        this.statement(SQL.recoverRun).run({
                            run_id: run.run_id,
                            now
                        });
                        this.statement(SQL.insertEvent).run({
                            app_instance_id: this.appInstanceId,
                            session_id: run.session_id,
                            run_id: run.run_id,
                            turn_id: null,
                            tool_span_id: null,
                            ts_ms: now,
                            event: "run.crashed",
                            detail_json: jsonDetail({
                                previousAppInstanceId: run.app_instance_id,
                                startedAtMs: Number(run.started_at_ms),
                                lastHeartbeatMs: Number(run.last_heartbeat_ms)
                            })
                        });
                    }
                    this.statement(SQL.recoverTurn).run({ now });
                    this.statement(SQL.recoverTool).run({ now });
                }

                const prunedRuns = this.statement(SQL.pruneRuns).run({ cutoff });
                const prunedEvents = this.statement(SQL.pruneEvents).run({ cutoff });
                deleted = Number(prunedRuns.changes) + Number(prunedEvents.changes);
                this.database.exec("COMMIT");
            } catch (error) {
                this.database.exec("ROLLBACK");
                throw error;
            }

            this.database.exec("PRAGMA optimize");
            if (deleted > 0) {
                this.database.exec("PRAGMA incremental_vacuum");
            }
            this.enforceSizeLimit();
        } catch (error) {
            this.recordFailure("maintenance", error);
        }
    }

    private enforceSizeLimit(): void {
        if (this.databasePath === ":memory:" || this.maxBytes <= 0) {
            return;
        }
        if (this.databaseSizeBytes() <= this.maxBytes) {
            return;
        }

        const row = this.database.prepare(SQL.countFinishedRuns).get();
        const count = Number(row?.count ?? 0);
        if (count === 0) {
            return;
        }

        const deleteCount = Math.max(1, Math.ceil(count * 0.25));
        this.statement(SQL.deleteOldestRuns).run({ count: deleteCount });
        this.statements.clear();
        this.database.exec("VACUUM");
    }

    private databaseSizeBytes(): number {
        let size = statSync(this.databasePath).size;
        const walPath = `${this.databasePath}-wal`;
        if (existsSync(walPath)) {
            size += statSync(walPath).size;
        }
        return size;
    }

    private write(
        event: string,
        sql: string,
        parameters: Record<string, unknown>
    ): void {
        if (this.closed) {
            this.recordFailure(event, new Error("Observability database is closed"));
            return;
        }
        try {
            this.statement(sql).run(toSqlParameters(parameters));
        } catch (error) {
            this.recordFailure(event, error);
        }
    }

    private statement(sql: string): StatementSync {
        let statement = this.statements.get(sql);
        if (!statement) {
            statement = this.database.prepare(sql);
            statement.setAllowBareNamedParameters(true);
            this.statements.set(sql, statement);
        }
        return statement;
    }

    private recordFailure(event: string, error: unknown): void {
        this.writeErrors += 1;
        this.droppedWrites += 1;
        const now = this.now();
        if (now - this.lastWarningAt < 60_000) {
            return;
        }
        this.lastWarningAt = now;
        this.logger.warn("Observability database write failed", {
            event,
            reason: error instanceof Error ? error.message : String(error)
        });
    }
}

export function createSqliteAgentObserver(
    options: SqliteObserverOptions
): AgentObserver {
    try {
        return new SqliteAgentObserver(options);
    } catch (error) {
        options.logger?.warn("Observability database unavailable", {
            databasePath: options.databasePath,
            reason: error instanceof Error ? error.message : String(error)
        });
        return noopAgentObserver;
    }
}

function toSqlParameters(
    parameters: Record<string, unknown>
): Record<string, SqlParameter> {
    const result: Record<string, SqlParameter> = {};
    for (const [key, value] of Object.entries(parameters)) {
        if (value === undefined) {
            result[key] = null;
        } else if (typeof value === "boolean") {
            result[key] = value ? 1 : 0;
        } else if (
            value === null ||
            typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "bigint" ||
            value instanceof Uint8Array
        ) {
            result[key] = value;
        } else {
            result[key] = JSON.stringify(value);
        }
    }
    return result;
}

function nullable<T>(value: T | undefined): T | null {
    return value ?? null;
}

function nullableNumber(value: number | undefined): number | null {
    return value === undefined || !Number.isFinite(value) ? null : value;
}

function nullableInteger(value: number | undefined): number | null {
    if (value === undefined || !Number.isFinite(value)) {
        return null;
    }
    return Math.round(value);
}

function toInteger(value: boolean | undefined): number {
    return value === true ? 1 : 0;
}

function jsonDetail(value: Record<string, unknown> | undefined): string | null {
    if (value === undefined) {
        return null;
    }
    try {
        const serialized = JSON.stringify(value);
        return serialized === undefined ? null : serialized;
    } catch {
        return null;
    }
}

function jsonText(value: string | undefined): string | null {
    if (value === undefined) {
        return null;
    }
    try {
        JSON.parse(value);
        return value;
    } catch {
        return null;
    }
}

function sanitizeError(value: string | undefined): string | null {
    if (value === undefined || value.length === 0) {
        return null;
    }
    const sanitized = value
        .slice(0, ERROR_MESSAGE_MAX_LENGTH)
        .replace(/https?:\/\/[^\s"'<>]+/gi, "[url]")
        .replace(/\b[A-Za-z]:\\[^\s"'<>]+/g, "[path]")
        .replace(/\/(?:Users|home|var|tmp)\/[^\s"'<>]+/g, "[path]")
        .replace(
            /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|password)\b\s*[:=]\s*[^\s,;]+/gi,
            "$1=[redacted]"
        )
        .replace(/\b(?:sk|pk|api)[-_][A-Za-z0-9_-]{8,}\b/gi, "[redacted]")
        .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]");
    return sanitized;
}
