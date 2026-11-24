import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test, vi } from "vitest";
import {
    createSqliteAgentObserver,
    SqliteAgentObserver
} from "./sqlite-observer.ts";
import {
    AGENT_DATABASE_VERSION,
    AGENT_SCHEMA_V1
} from "./schema.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

function temporaryDatabase(): { directory: string; databasePath: string } {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-observability-"));
    return {
        directory,
        databasePath: join(directory, "agent.sqlite3")
    };
}

test("persists run, turn, and tool records", () => {
    const { directory, databasePath } = temporaryDatabase();
    const observer = new SqliteAgentObserver({
        databasePath,
        appVersion: "test",
        buildId: "build-1",
        appInstanceId: "app-1",
        now: () => 10_000
    });

    try {
        observer.runStarted({
            runId: "run-1",
            sessionId: "session-1",
            runType: "prompt",
            startedAtMs: 1_000,
            provider: "test-provider",
            model: "test-model",
            permission: "workspace-write",
            promptChars: 12,
            historyMessagesAtStart: 3,
            contextWindow: 200_000,
            contextTokensStart: 1_200,
            maxRounds: 32,
            reasoningLevel: "high",
            systemPromptHash: "prompt-hash",
            toolsetHash: "toolset-hash",
            toolCount: 4
        });
        observer.turnStarted({
            turnId: "turn-1",
            sessionId: "session-1",
            runId: "run-1",
            turnKind: "main",
            turnIndex: 0,
            startedAtMs: 1_000,
            provider: "test-provider",
            model: "test-model",
            messageCount: 4,
            contextTokensBefore: 1_200
        });
        observer.toolStarted({
            toolSpanId: "tool-1",
            sessionId: "session-1",
            runId: "run-1",
            turnId: "turn-1",
            turnIndex: 0,
            stepIndex: 0,
            toolCallId: "call-1",
            toolName: "exec_command",
            toolCategory: "shell",
            startedAtMs: 1_100,
            argsBytes: 10,
            argsHash: "hash",
            detail: { command: "echo hi" }
        });
        observer.toolFinished("tool-1", {
            endedAtMs: 1_900,
            durationMs: 800.6,
            outcome: "success",
            permissionRequests: 0,
            permissionWaitMs: 1.4,
            executionMs: 799.2,
            isError: false,
            endReason: "exited",
            outputChars: 120,
            outputBytes: 120,
            truncated: false,
            imageCount: 0,
            repeatIndex: 0,
            repeatGroupSize: 1,
            detail: { exitCode: 0 }
        });
        observer.turnFinished("turn-1", {
            endedAtMs: 2_500,
            durationMs: 1_500.6,
            outcome: "completed",
            ttftMs: 250.4,
            firstTokenKind: "text",
            generationMs: 1_000.3,
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 20,
            costUsd: 0.01,
            tokensPerSecond: 50,
            wallTokensPerSecond: 33.3,
            stopReason: "toolUse",
            responseId: "resp-1",
            toolCalls: 1,
            contextTokensAfter: 1_400,
            llmHttpAttempts: 2,
            llmRetries: 1,
            rateLimitResponses: 1,
            retryAfterMs: 250,
            providerHttpStatus: 200
        });
        observer.runFinished("run-1", {
            endedAtMs: 3_000,
            durationMs: 2_000.7,
            outcome: "completed",
            activeDurationMs: 1_999.2,
            llmTurns: 1,
            toolCalls: 1,
            agentSteps: 2,
            permissionWaitMs: 1.4,
            llmDurationMs: 1_500.4,
            toolDurationMs: 800.6,
            toolExecutionMs: 799.2,
            toolErrors: 0,
            toolSequenceJson: "[\"exec_command\"]",
            inputTokens: 100,
            outputTokens: 50,
            costUsd: 0.01,
            tokensPerSecond: 50,
            wallTokensPerSecond: 25,
            finalStopReason: "stop",
            submitToFirstTokenMs: 900,
            llmHttpAttempts: 2,
            llmRetries: 1,
            rateLimitResponses: 1,
            retryAfterMs: 250,
            providerHttpStatus: 200
        });

        expect(observer.stats()).toEqual({
            writeErrors: 0,
            droppedWrites: 0
        });
    } finally {
        observer.close();
    }

    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
        const run = database.prepare("SELECT * FROM runs WHERE run_id = ?").get("run-1");
        expect(run?.outcome).toBe("completed");
        expect(run?.agent_steps).toBe(2);
        expect(run?.duration_ms).toBe(2_001);
        expect(run?.active_duration_ms).toBe(1_999);
        expect(run?.tool_execution_ms).toBe(799);
        expect(run?.tool_sequence_json).toBe("[\"exec_command\"]");
        expect(run?.app_version).toBe("test");
        expect(run?.build_id).toBe("build-1");
        expect(run?.reasoning_level).toBe("high");
        expect(run?.system_prompt_hash).toBe("prompt-hash");
        expect(run?.toolset_hash).toBe("toolset-hash");
        expect(run?.tool_count).toBe(4);
        expect(run?.submit_to_first_token_ms).toBe(900);
        expect(run?.llm_http_attempts).toBe(2);
        expect(run?.llm_retries).toBe(1);
        expect(run?.rate_limit_responses).toBe(1);
        expect(run?.retry_after_ms).toBe(250);
        expect(run?.provider_http_status).toBe(200);

        const turn = database.prepare("SELECT * FROM turns WHERE turn_id = ?").get("turn-1");
        expect(turn?.outcome).toBe("completed");
        expect(turn?.ttft_ms).toBe(250);
        expect(turn?.duration_ms).toBe(1_501);
        expect(turn?.tokens_per_second).toBe(50);
        expect(turn?.llm_http_attempts).toBe(2);
        expect(turn?.llm_retries).toBe(1);
        expect(turn?.rate_limit_responses).toBe(1);
        expect(turn?.retry_after_ms).toBe(250);
        expect(turn?.provider_http_status).toBe(200);

        const tool = database.prepare("SELECT * FROM tools WHERE tool_span_id = ?").get("tool-1");
        expect(tool?.outcome).toBe("success");
        expect(tool?.duration_ms).toBe(801);
        expect(tool?.permission_wait_ms).toBe(1);
        expect(tool?.execution_ms).toBe(799);
        expect(tool?.detail_json).toContain("\"exitCode\":0");

        const schemaVersion = database.prepare(
            "SELECT value FROM meta WHERE key = 'schema_version'"
        ).get();
        expect(schemaVersion?.value).toBe(String(AGENT_DATABASE_VERSION));

    } finally {
        database.close();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("marks interrupted records as crashed on startup", () => {
    const { directory, databasePath } = temporaryDatabase();
    const first = new SqliteAgentObserver({
        databasePath,
        appVersion: "test",
        appInstanceId: "app-1",
        now: () => 10_000
    });

    try {
        first.runStarted({
            runId: "run-1",
            sessionId: "session-1",
            runType: "prompt",
            startedAtMs: 1_000
        });
        first.turnStarted({
            turnId: "turn-1",
            sessionId: "session-1",
            runId: "run-1",
            turnKind: "main",
            turnIndex: 0,
            startedAtMs: 1_000
        });
        first.toolStarted({
            toolSpanId: "tool-1",
            sessionId: "session-1",
            runId: "run-1",
            turnId: "turn-1",
            turnIndex: 0,
            stepIndex: 0,
            toolName: "exec_command",
            toolCategory: "shell",
            startedAtMs: 1_000
        });
    } finally {
        first.close();
    }

    const second = new SqliteAgentObserver({
        databasePath,
        appVersion: "test",
        appInstanceId: "app-2",
        now: () => 20_000
    });
    second.close();

    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
        const run = database.prepare("SELECT * FROM runs WHERE run_id = 'run-1'").get();
        expect(run?.outcome).toBe("crashed");
        expect(run?.duration_ms).toBe(19_000);
        expect(run?.error_code).toBe("app_crashed");

        const turn = database.prepare("SELECT * FROM turns WHERE turn_id = 'turn-1'").get();
        expect(turn?.outcome).toBe("error");
        expect(turn?.error_code).toBe("app_crashed");

        const tool = database.prepare("SELECT * FROM tools WHERE tool_span_id = 'tool-1'").get();
        expect(tool?.outcome).toBe("error");
        expect(tool?.error_code).toBe("app_crashed");

        const event = database.prepare(
            "SELECT * FROM events WHERE event = 'run.crashed'"
        ).get();
        expect(event?.run_id).toBe("run-1");
        expect(event?.app_instance_id).toBe("app-2");
    } finally {
        database.close();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("migrates a version 1 database without losing existing records", () => {
    const { directory, databasePath } = temporaryDatabase();
    const legacy = new DatabaseSync(databasePath, {
        enableForeignKeyConstraints: true
    });
    try {
        legacy.exec(AGENT_SCHEMA_V1);
        legacy.exec("PRAGMA user_version = 1");
        legacy.prepare(`
            INSERT INTO runs (
                run_id, app_instance_id, session_id, run_type, started_at_ms,
                last_heartbeat_ms, outcome, llm_turns, tool_calls, agent_steps
            ) VALUES (?, ?, ?, 'prompt', ?, ?, 'completed', 1, 0, 1)
        `).run("run-v1", "app-v1", "session-v1", 9_000, 9_500);
        legacy.prepare(`
            INSERT INTO turns (
                turn_id, app_instance_id, session_id, run_id, turn_kind,
                started_at_ms, outcome
            ) VALUES (?, ?, ?, ?, 'main', ?, 'completed')
        `).run("turn-v1", "app-v1", "session-v1", "run-v1", 9_000);
    } finally {
        legacy.close();
    }

    const observer = new SqliteAgentObserver({
        databasePath,
        appVersion: "test",
        appInstanceId: "app-v2",
        now: () => 10_000
    });
    observer.close();

    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
        expect(
            database.prepare("PRAGMA user_version").get()?.user_version
        ).toBe(AGENT_DATABASE_VERSION);
        const runColumns = database.prepare("PRAGMA table_info(runs)").all()
            .map((column) => column.name);
        expect(runColumns).toEqual(expect.arrayContaining([
            "app_version",
            "build_id",
            "reasoning_level",
            "system_prompt_hash",
            "toolset_hash",
            "tool_count",
            "submit_to_first_token_ms",
            "llm_http_attempts",
            "llm_retries",
            "rate_limit_responses",
            "retry_after_ms",
            "provider_http_status"
        ]));
        const turnColumns = database.prepare("PRAGMA table_info(turns)").all()
            .map((column) => column.name);
        expect(turnColumns).toEqual(expect.arrayContaining([
            "llm_http_attempts",
            "llm_retries",
            "rate_limit_responses",
            "retry_after_ms",
            "provider_http_status"
        ]));

        const run = database.prepare(
            "SELECT * FROM runs WHERE run_id = 'run-v1'"
        ).get();
        expect(run?.outcome).toBe("completed");
        expect(run?.llm_http_attempts).toBe(0);
        expect(run?.app_version).toBeNull();
        const turn = database.prepare(
            "SELECT * FROM turns WHERE turn_id = 'turn-v1'"
        ).get();
        expect(turn?.outcome).toBe("completed");
        expect(turn?.llm_http_attempts).toBe(0);
    } finally {
        database.close();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("does not recover active runs during periodic maintenance", () => {
    vi.useFakeTimers();
    const { directory, databasePath } = temporaryDatabase();
    const observer = new SqliteAgentObserver({
        databasePath,
        appVersion: "test",
        now: () => 10_000
    });
    try {
        observer.runStarted({
            runId: "run-active",
            sessionId: "session-1",
            runType: "prompt",
            startedAtMs: 9_000
        });
        vi.advanceTimersByTime(DAY_MS);
    } finally {
        observer.close();
        vi.useRealTimers();
    }

    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
        const run = database.prepare(
            "SELECT outcome FROM runs WHERE run_id = 'run-active'"
        ).get();
        expect(run?.outcome).toBe("running");
    } finally {
        database.close();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("fails open when the database is closed or unavailable", () => {
    const { directory, databasePath } = temporaryDatabase();
    const observer = new SqliteAgentObserver({
        databasePath,
        appVersion: "test",
        now: () => 10_000
    });
    observer.close();

    expect(() => observer.runStarted({
        runId: "run-after-close",
        sessionId: "session-1",
        runType: "prompt",
        startedAtMs: 1_000
    })).not.toThrow();
    expect(observer.stats().writeErrors).toBeGreaterThan(0);

    const blockedPath = join(directory, "blocked");
    writeFileSync(blockedPath, "not a directory");
    const fallback = createSqliteAgentObserver({
        databasePath: join(blockedPath, "agent.sqlite3"),
        appVersion: "test"
    });
    expect(() => fallback.runStarted({
        runId: "run-unavailable",
        sessionId: "session-1",
        runType: "prompt",
        startedAtMs: 1_000
    })).not.toThrow();
    expect(fallback.stats()).toEqual({
        writeErrors: 0,
        droppedWrites: 0
    });
    fallback.close();

    rmSync(directory, { recursive: true, force: true });
});

test("redacts credentials, paths, and URLs from errors", () => {
    const { directory, databasePath } = temporaryDatabase();
    const observer = new SqliteAgentObserver({
        databasePath,
        appVersion: "test",
        now: () => 10_000
    });
    try {
        observer.runStarted({
            runId: "run-error",
            sessionId: "session-1",
            runType: "prompt",
            startedAtMs: 1_000
        });
        observer.runFinished("run-error", {
            endedAtMs: 2_000,
            durationMs: 1_000,
            outcome: "failed",
            errorStage: "llm_stream",
            errorCode: "llm_stream_error",
            errorMessage: [
                "request failed at C:\\Users\\secret\\project.txt",
                "api_key=" + "plain-secret-value",
                "https://example.com/private"
            ].join(" "),
            llmTurns: 1,
            toolCalls: 0,
            agentSteps: 1
        });
    } finally {
        observer.close();
    }

    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
        const run = database.prepare(
            "SELECT error_message FROM runs WHERE run_id = 'run-error'"
        ).get();
        expect(run?.error_message).toContain("[path]");
        expect(run?.error_message).toContain("api_key=[redacted]");
        expect(run?.error_message).toContain("[url]");
        expect(run?.error_message).not.toContain("plain-secret-value");
        expect(run?.error_message).not.toContain("example.com");
    } finally {
        database.close();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("prunes expired runs and cascades turns and tools", () => {
    const { directory, databasePath } = temporaryDatabase();
    const now = Date.UTC(2026, 10, 24);
    const old = now - 40 * DAY_MS;
    const first = new SqliteAgentObserver({
        databasePath,
        appVersion: "test",
        now: () => now,
        retentionDays: 30
    });

    try {
        first.runStarted({
            runId: "run-old",
            sessionId: "session-1",
            runType: "prompt",
            startedAtMs: old
        });
        first.turnStarted({
            turnId: "turn-old",
            sessionId: "session-1",
            runId: "run-old",
            turnKind: "main",
            turnIndex: 0,
            startedAtMs: old
        });
        first.toolStarted({
            toolSpanId: "tool-old",
            sessionId: "session-1",
            runId: "run-old",
            turnId: "turn-old",
            turnIndex: 0,
            stepIndex: 0,
            toolName: "exec_command",
            toolCategory: "shell",
            startedAtMs: old
        });
        first.toolFinished("tool-old", {
            endedAtMs: old + 100,
            durationMs: 100,
            outcome: "success"
        });
        first.turnFinished("turn-old", {
            endedAtMs: old + 200,
            durationMs: 200,
            outcome: "completed",
            toolCalls: 1
        });
        first.runFinished("run-old", {
            endedAtMs: old + 300,
            durationMs: 300,
            outcome: "completed",
            llmTurns: 1,
            toolCalls: 1,
            agentSteps: 2
        });
    } finally {
        first.close();
    }

    const second = new SqliteAgentObserver({
        databasePath,
        appVersion: "test",
        now: () => now,
        retentionDays: 30
    });
    second.close();

    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
        expect(
            database.prepare("SELECT count(*) AS count FROM runs").get()?.count
        ).toBe(0);
        expect(
            database.prepare("SELECT count(*) AS count FROM turns").get()?.count
        ).toBe(0);
        expect(
            database.prepare("SELECT count(*) AS count FROM tools").get()?.count
        ).toBe(0);
    } finally {
        database.close();
        rmSync(directory, { recursive: true, force: true });
    }
});
