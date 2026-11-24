import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { SqliteAgentObserver } from "./sqlite-observer.ts";

test("renders JSON and Markdown reports from a version 2 database", () => {
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
            totals: { promptRuns: number };
            promptRuns: {
                submitToFirstTokenMs: { n: number };
                llmRetries: number;
            };
            tools: {
                byName: { truncatedRate: number; repeatRate: number }[];
            };
            daily: unknown[];
            findings: unknown[];
        };
        expect(report.totals.promptRuns).toBe(2);
        expect(report.promptRuns.submitToFirstTokenMs.n).toBe(1);
        expect(report.promptRuns.llmRetries).toBe(1);
        expect(report.tools.byName[0]).toMatchObject({
            truncatedRate: 1,
            repeatRate: 1
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
