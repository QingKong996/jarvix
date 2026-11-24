import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { SqliteAgentObserver } from "./sqlite-observer.ts";

test("renders JSON and Markdown reports from a version 3 database", () => {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-report-"));
    const databasePath = join(directory, "agent.sqlite3");
    const now = Date.now();
    const observer = new SqliteAgentObserver({
        databasePath,
        appVersion: "0.1.0",
        buildId: "test-build",
        appInstanceId: "app-report",
        now: () => now
    });

    try {
        observer.runStarted({
            runId: "run_report_ok",
            sessionId: "session-report",
            runType: "prompt",
            startedAtMs: now - 10_000,
            provider: "test",
            model: "test-model",
            promptChars: 20,
            reasoningLevel: "high",
            systemPromptHash: "prompt-hash",
            toolsetHash: "toolset-hash",
            toolCount: 2
        });
        observer.turnStarted({
            turnId: "turn_report_ok",
            sessionId: "session-report",
            runId: "run_report_ok",
            turnKind: "main",
            turnIndex: 0,
            startedAtMs: now - 9_000,
            provider: "test",
            model: "test-model"
        });
        observer.llmAttemptStarted({
            attemptId: "turn_report_ok:a0",
            sessionId: "session-report",
            runId: "run_report_ok",
            turnId: "turn_report_ok",
            attemptIndex: 0,
            startedAtMs: now - 8_900
        });
        observer.llmAttemptFinished("turn_report_ok:a0", {
            endedAtMs: now - 8_800,
            durationMs: 100,
            outcome: "error",
            httpStatus: 429,
            retryAfterMs: 100,
            errorCode: "llm_http_429"
        });
        observer.llmAttemptStarted({
            attemptId: "turn_report_ok:a1",
            sessionId: "session-report",
            runId: "run_report_ok",
            turnId: "turn_report_ok",
            attemptIndex: 1,
            startedAtMs: now - 8_700
        });
        observer.llmAttemptFinished("turn_report_ok:a1", {
            endedAtMs: now - 8_500,
            durationMs: 200,
            outcome: "response",
            httpStatus: 200
        });
        observer.toolStarted({
            toolSpanId: "tool_report_ok",
            sessionId: "session-report",
            runId: "run_report_ok",
            turnId: "turn_report_ok",
            turnIndex: 0,
            stepIndex: 0,
            toolName: "exec_command",
            toolCategory: "shell",
            startedAtMs: now - 8_000
        });
        observer.toolFinished("tool_report_ok", {
            endedAtMs: now - 7_500,
            durationMs: 500,
            outcome: "success",
            outputChars: 100,
            outputBytes: 100,
            truncated: true,
            repeatIndex: 1
        });
        observer.turnFinished("turn_report_ok", {
            endedAtMs: now - 7_000,
            durationMs: 2_000,
            outcome: "completed",
            ttftMs: 250,
            outputTokens: 100,
            tokensPerSecond: 50,
            toolCalls: 1,
            llmHttpAttempts: 2,
            llmRetries: 1,
            rateLimitResponses: 1,
            retryAfterMs: 100,
            providerHttpStatus: 200
        });
        observer.runFinished("run_report_ok", {
            endedAtMs: now - 5_000,
            durationMs: 5_000,
            outcome: "completed",
            llmTurns: 1,
            toolCalls: 1,
            agentSteps: 2,
            submitToFirstTokenMs: 750,
            inputTokens: 200,
            outputTokens: 100,
            costUsd: 0.01,
            tokensPerSecond: 50,
            wallTokensPerSecond: 20,
            finalStopReason: "stop",
            llmHttpAttempts: 2,
            llmRetries: 1,
            rateLimitResponses: 1,
            retryAfterMs: 100,
            providerHttpStatus: 200
        });
        observer.runStarted({
            runId: "run_report_failed",
            sessionId: "session-report",
            runType: "prompt",
            startedAtMs: now - 4_000,
            provider: "test",
            model: "test-model"
        });
        observer.runFinished("run_report_failed", {
            endedAtMs: now - 3_000,
            durationMs: 1_000,
            outcome: "failed",
            errorStage: "llm_stream",
            errorCode: "llm_rate_limited",
            llmTurns: 0,
            toolCalls: 0,
            agentSteps: 0
        });
        observer.runStarted({
            runId: "run_report_active",
            sessionId: "session-report",
            runType: "prompt",
            startedAtMs: now - 1_000,
            provider: "test",
            model: "test-model"
        });
    } finally {
        observer.close();
    }

    const script = resolve("scripts/agent-report.mjs");
    try {
        const jsonOutput = execFileSync(process.execPath, [
            "--disable-warning=ExperimentalWarning",
            script,
            "--db",
            databasePath,
            "--days",
            "30",
            "--format",
            "json"
        ], {
            cwd: process.cwd(),
            encoding: "utf8"
        });
        const report = JSON.parse(jsonOutput) as {
            totals: {
                promptRuns: number;
                finishedPromptRuns: number;
                activePromptRuns: number;
            };
            promptRuns: {
                runCount: number;
                submitToFirstTokenMs: { n: number };
                llmRetries: number;
            };
            runs: {
                byVersion: { provider: string; model: string }[];
                modelSegments: { model: string; currentRuns: number }[];
            };
            interaction: {
                fastFollowUpComparable: number;
                fastFollowUpRate: number;
            };
            llmAttempts: {
                attempts: number;
                firstAttemptSuccessRate: number;
                byStatus: { key: string; count: number }[];
            };
            tools: {
                byName: { truncatedRate: number; repeatRate: number }[];
            };
            observerHealth: {
                writeErrors: number;
                droppedWrites: number;
            };
            daily: unknown[];
            findings: unknown[];
        };
        expect(report.totals).toMatchObject({
            promptRuns: 3,
            finishedPromptRuns: 2,
            activePromptRuns: 1
        });
        expect(report.promptRuns.runCount).toBe(2);
        expect(report.promptRuns.submitToFirstTokenMs.n).toBe(1);
        expect(report.promptRuns.llmRetries).toBe(1);
        expect(report.runs.byVersion[0]).toMatchObject({
            provider: "test",
            model: "test-model"
        });
        expect(report.runs.modelSegments[0]).toMatchObject({
            model: "test/test-model",
            currentRuns: 2
        });
        expect(report.interaction).toMatchObject({
            fastFollowUpComparable: 1,
            fastFollowUpRate: 1
        });
        expect(report.llmAttempts).toMatchObject({
            attempts: 2,
            firstAttemptSuccessRate: 0
        });
        expect(report.llmAttempts.byStatus).toEqual(expect.arrayContaining([
            { key: "429", count: 1 },
            { key: "200", count: 1 }
        ]));
        expect(report.tools.byName[0]).toMatchObject({
            truncatedRate: 1,
            repeatRate: 1
        });
        expect(report.observerHealth).toEqual({
            writeErrors: 0,
            droppedWrites: 0
        });
        expect(report.daily).toHaveLength(1);

        const markdown = execFileSync(process.execPath, [
            "--disable-warning=ExperimentalWarning",
            script,
            "--db",
            databasePath,
            "--days",
            "30"
        ], {
            cwd: process.cwd(),
            encoding: "utf8"
        });
        expect(markdown).toContain("## 自动发现");
        expect(markdown).toContain("## 每日趋势");
        expect(markdown).toContain("## 版本分组");
        expect(markdown).toContain("## 按模型环比");
        expect(markdown).toContain("## LLM HTTP 尝试");
        expect(markdown).toContain("## 交互反复代理指标");
        expect(markdown).toContain("提交→首 Token p50 / p95");
        expect(markdown).not.toContain("undefined");
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test("renders an empty Markdown report for a freshly migrated database", () => {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-report-empty-"));
    const databasePath = join(directory, "agent.sqlite3");
    const observer = new SqliteAgentObserver({
        databasePath,
        appVersion: "0.1.0"
    });
    observer.close();

    try {
        const markdown = execFileSync(process.execPath, [
            "--disable-warning=ExperimentalWarning",
            resolve("scripts/agent-report.mjs"),
            "--db",
            databasePath,
            "--days",
            "30"
        ], {
            cwd: process.cwd(),
            encoding: "utf8"
        });
        expect(markdown).toContain("| Prompt Run | 0 |");
        expect(markdown).toContain("| 暂无数据 | - | 0 |");
        expect(markdown).not.toContain("undefined");
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
