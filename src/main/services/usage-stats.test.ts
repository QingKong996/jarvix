import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import type { JarvixConfig } from "../../protocol/config.ts";
import { SqliteAgentObserver } from "../observability/sqlite-observer.ts";
import { UsageStatsService, usageWindow } from "./usage-stats.ts";

function temporaryDatabase(): { directory: string; databasePath: string } {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-usage-"));
    return {
        directory,
        databasePath: join(directory, "agent.sqlite3")
    };
}

test("returns every request and recalculates cost from current pricing", () => {
    const { directory, databasePath } = temporaryDatabase();
    const now = new Date(2026, 10, 28, 12, 0, 0).getTime();
    const yesterday = new Date(2026, 10, 27, 9, 30, 0).getTime();
    const observer = new SqliteAgentObserver({
        databasePath,
        appVersion: "test",
        now: () => now
    });
    try {
        addTurn(observer, "run-1", "turn-1", yesterday, 150_000, 10_000, 50_000);
        addTurn(observer, "run-2", "turn-2", now, 20_000, 5_000, 3_000);
    } finally {
        observer.close();
    }

    const config: JarvixConfig = {
        providers: [{
            id: "provider",
            name: "Provider",
            protocol: "openai-completions",
            baseUrl: "https://example.com/v1",
            env: [],
            models: [{
                id: "model",
                name: "Model",
                reasoning: false,
                contextWindow: 1_000_000,
                maxTokens: 100_000,
                input: ["text"],
                toolCall: false,
                cost: {
                    input: 1,
                    output: 10,
                    cacheRead: 0.1,
                    cacheWrite: 1.25,
                    tiers: [{
                        inputTokensAbove: 200_000,
                        input: 2,
                        output: 20,
                        cacheRead: 0.2,
                        cacheWrite: 2.5
                    }]
                }
            }]
        }]
    };
    try {
        const stats = new UsageStatsService({
            databasePath,
            getConfig: () => config,
            now: () => now
        }).stats({ period: "7d" });

        expect(stats.period).toBe("7d");
        expect(stats.requests).toHaveLength(2);
        expect(stats.requests.map((request) => request.turnId))
            .toEqual(["turn-2", "turn-1"]);
        expect(stats.requests.reduce(
            (total, request) => total + request.totalTokens,
            0
        )).toBe(248_000);
        expect(stats.requests.reduce(
            (total, request) => total + request.costUsd,
            0
        )).toBeCloseTo(0.59905, 8);
        expect(stats.requests[1]?.costUsd).toBeCloseTo(0.5225, 8);
        expect(stats.requests[0]).toMatchObject({
            ttftMs: 1_200,
            generationMs: 2_000,
            retries: 1,
            httpAttempts: 2,
            receivedTextChars: 800,
            receivedThinkingChars: 120
        });
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test("builds local period windows", () => {
    const now = new Date(2026, 10, 28, 12, 0, 0).getTime();
    expect(usageWindow({ period: "today" }, now)).toEqual({
        fromMs: new Date(2026, 10, 28).getTime(),
        toMs: new Date(2026, 10, 29).getTime()
    });
    expect(usageWindow({ period: "24h" }, now)).toEqual({
        fromMs: now - 24 * 60 * 60 * 1_000,
        toMs: now
    });
    expect(usageWindow({ period: "7d" }, now)).toEqual({
        fromMs: new Date(2026, 10, 22).getTime(),
        toMs: new Date(2026, 10, 29).getTime()
    });
    expect(usageWindow({ period: "30d" }, now)).toEqual({
        fromMs: new Date(2026, 9, 30).getTime(),
        toMs: new Date(2026, 10, 29).getTime()
    });
    expect(usageWindow({
        period: "custom",
        fromMs: 100,
        toMs: 200
    }, now)).toEqual({ fromMs: 100, toMs: 200 });
    expect(usageWindow({ period: "all" }, now)).toEqual({
        fromMs: 0,
        toMs: now + 1
    });
});

test("returns one persisted context sample per main step", () => {
    const { directory, databasePath } = temporaryDatabase();
    const observer = new SqliteAgentObserver({
        databasePath,
        appVersion: "test",
        now: () => 10_000
    });
    try {
        observer.runStarted({
            runId: "run-context",
            sessionId: "session-context",
            runType: "prompt",
            startedAtMs: 1_000
        });
        observer.turnStarted({
            turnId: "turn-context-1",
            sessionId: "session-context",
            runId: "run-context",
            turnKind: "main",
            turnIndex: 0,
            startedAtMs: 1_000,
            contextTokensBefore: 1_200
        });
        observer.turnFinished("turn-context-1", {
            endedAtMs: 2_000,
            durationMs: 1_000,
            outcome: "completed",
            contextTokensAfter: 1_800
        });
        observer.turnStarted({
            turnId: "turn-context-2",
            sessionId: "session-context",
            runId: "run-context",
            turnKind: "main",
            turnIndex: 1,
            startedAtMs: 3_000,
            contextTokensBefore: 2_400
        });
        observer.turnFinished("turn-context-2", {
            endedAtMs: 4_000,
            durationMs: 1_000,
            outcome: "completed",
            contextTokensAfter: 3_000
        });
    } finally {
        observer.close();
    }

    try {
        const history = new UsageStatsService({
            databasePath,
            getConfig: () => ({})
        }).contextHistory("session-context");

        expect(history).toEqual([
            { step: 1, atMs: 1_000, estimatedTokens: 1_200 },
            { step: 2, atMs: 3_000, estimatedTokens: 2_400 }
        ]);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test("returns persisted cache usage for each main step", () => {
    const { directory, databasePath } = temporaryDatabase();
    const sessionId = "session-cache";
    const observer = new SqliteAgentObserver({
        databasePath,
        appVersion: "test",
        now: () => 10_000
    });
    try {
        observer.runStarted({
            runId: "run-cache",
            sessionId,
            runType: "prompt",
            startedAtMs: 1_000
        });
        observer.turnStarted({
            turnId: "turn-cache-1",
            sessionId,
            runId: "run-cache",
            turnKind: "main",
            turnIndex: 0,
            startedAtMs: 1_000,
            provider: "provider",
            model: "model"
        });
        observer.turnFinished("turn-cache-1", {
            endedAtMs: 2_000,
            durationMs: 1_000,
            outcome: "completed",
            inputTokens: 1_000,
            cacheReadTokens: 4_000,
            cacheWriteTokens: 500
        });
        observer.turnStarted({
            turnId: "turn-cache-2",
            sessionId,
            runId: "run-cache",
            turnKind: "main",
            turnIndex: 1,
            startedAtMs: 3_000,
            provider: "provider",
            model: "model"
        });
        observer.turnFinished("turn-cache-2", {
            endedAtMs: 4_000,
            durationMs: 1_000,
            outcome: "completed",
            inputTokens: 2_000,
            cacheReadTokens: 6_000,
            cacheWriteTokens: 0
        });
    } finally {
        observer.close();
    }

    try {
        const history = new UsageStatsService({
            databasePath,
            getConfig: () => ({})
        }).cacheHistory(sessionId);

        expect(history).toEqual([
            {
                step: 1,
                atMs: 1_000,
                inputTokens: 1_000,
                cacheReadTokens: 4_000,
                cacheWriteTokens: 500
            },
            {
                step: 2,
                atMs: 3_000,
                inputTokens: 2_000,
                cacheReadTokens: 6_000,
                cacheWriteTokens: 0
            }
        ]);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

function addTurn(
    observer: SqliteAgentObserver,
    runId: string,
    turnId: string,
    startedAtMs: number,
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens: number
): void {
    observer.runStarted({
        runId,
        sessionId: `session-${runId}`,
        runType: "prompt",
        startedAtMs
    });
    observer.turnStarted({
        turnId,
        sessionId: `session-${runId}`,
        runId,
        turnKind: "main",
        turnIndex: 0,
        startedAtMs,
        provider: "provider",
        model: "model"
    });
    observer.turnFinished(turnId, {
        endedAtMs: startedAtMs + 1_000,
        durationMs: 3_200,
        outcome: "completed",
        ttftMs: 1_200,
        generationMs: 2_000,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens: 5_000,
        costUsd: 999,
        llmHttpAttempts: 2,
        llmRetries: 1,
        receivedTextChars: 800,
        receivedThinkingChars: 120
    });
}
