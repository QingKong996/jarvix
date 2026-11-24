#!/usr/bin/env node

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const DAY_MS = 24 * 60 * 60 * 1_000;
const MIN_P95_SAMPLES = 20;
const MAX_SLOW_RUNS = 10;
const MAX_DAILY_ROWS = 90;

const options = parseArguments(process.argv.slice(2));
if (options.help) {
    printHelp();
    process.exit(0);
}

const databasePath = options.databasePath
    ?? join(homedir(), ".jarvix", "observability", "agent.sqlite3");
if (!existsSync(databasePath)) {
    console.error(`Observability database not found: ${databasePath}`);
    process.exit(1);
}

const sinceMs = Date.now() - options.days * DAY_MS;
const previousSinceMs = sinceMs - options.days * DAY_MS;
const database = new DatabaseSync(databasePath, { readOnly: true });
let report;
try {
    database.exec("PRAGMA busy_timeout = 1000");
    const schemaVersion = Number(
        database.prepare("PRAGMA user_version").get()?.user_version ?? 0
    );
    if (schemaVersion !== 2) {
        throw new Error(
            `Unsupported observability schema version: ${schemaVersion}. Start Jarvix once to migrate it to version 2.`
        );
    }
    report = collectReport(database, {
        databasePath,
        days: options.days,
        sinceMs,
        previousSinceMs
    });
} finally {
    database.close();
}

if (options.format === "json") {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
    process.stdout.write(renderMarkdown(report));
}

function collectReport(database, window) {
    const runs = loadRuns(database, window.sinceMs, Number.MAX_SAFE_INTEGER);
    const previousRuns = loadRuns(
        database,
        window.previousSinceMs,
        window.sinceMs
    );
    const turns = database.prepare(`
        SELECT
            t.turn_id, t.run_id, t.turn_kind, t.provider, t.model, t.outcome,
            t.duration_ms, t.ttft_ms, t.first_token_kind, t.input_tokens,
            t.output_tokens, t.cache_read_tokens, t.cache_write_tokens,
            t.reasoning_tokens, t.cost_usd, t.tokens_per_second,
            t.wall_tokens_per_second, t.stop_reason, t.tool_calls,
            t.context_tokens_before, t.context_tokens_after,
            t.received_text_chars, t.received_thinking_chars,
            t.llm_http_attempts, t.llm_retries, t.rate_limit_responses,
            t.retry_after_ms, t.provider_http_status, t.error_code
        FROM turns t
        JOIN runs r ON r.run_id = t.run_id
        WHERE r.started_at_ms >= ? AND r.started_at_ms < ?
        ORDER BY t.started_at_ms DESC
    `).all(window.sinceMs, Number.MAX_SAFE_INTEGER);
    const tools = database.prepare(`
        SELECT
            t.tool_span_id, t.run_id, t.turn_id, t.step_index, t.tool_name,
            t.tool_category, t.started_at_ms,
            t.ended_at_ms, t.duration_ms, t.outcome, t.permission_requests,
            t.permission_wait_ms, t.execution_ms, t.is_error, t.end_reason,
            t.error_code, t.output_chars, t.output_bytes, t.image_count,
            t.truncated, t.repeat_index, t.repeat_group_size
        FROM tools t
        JOIN runs r ON r.run_id = t.run_id
        WHERE r.started_at_ms >= ? AND r.started_at_ms < ?
        ORDER BY t.started_at_ms DESC
    `).all(window.sinceMs, Number.MAX_SAFE_INTEGER);
    const promptRuns = runs.filter((run) => run.run_type === "prompt");
    const previousPromptRuns = previousRuns.filter(
        (run) => run.run_type === "prompt"
    );
    const namingRuns = runs.filter((run) => run.run_type === "naming");
    const mainTurns = turns.filter((turn) => turn.turn_kind === "main");
    const completedMainTurns = mainTurns.filter((turn) => turn.outcome === "completed");
    const completedTools = tools.filter((tool) => tool.outcome !== "running");
    const currentSummary = promptRunMetrics(promptRuns, completedTools);
    const previousSummary = promptRunMetrics(
        previousPromptRuns,
        []
    );
    const toolSummary = toolMetrics(completedTools);
    const dataQuality = {
        promptRunsMissingTtft: missingMetric(promptRuns, "ttft_ms"),
        promptRunsMissingFirstToken: missingMetric(
            promptRuns,
            "submit_to_first_token_ms"
        ),
        promptRunsMissingUsage: missingMetric(promptRuns, "output_tokens"),
        promptRunsMissingCost: missingMetric(promptRuns, "cost_usd"),
        promptRunsMissingAppVersion: missingMetric(promptRuns, "app_version"),
        promptRunsMissingPromptHash: missingMetric(
            promptRuns,
            "system_prompt_hash"
        ),
        promptRunsMissingToolsetHash: missingMetric(promptRuns, "toolset_hash"),
        mainTurnsMissingTtft: missingMetric(mainTurns, "ttft_ms"),
        mainTurnsMissingUsage: missingMetric(mainTurns, "output_tokens"),
        runsStillRunning: runs.filter((run) => run.outcome === "running").length,
        turnsStillRunning: turns.filter((turn) => turn.outcome === "running").length,
        toolsStillRunning: tools.filter((tool) => tool.outcome === "running").length,
        p95Rule: `p95 is omitted when n < ${MIN_P95_SAMPLES}`
    };

    return {
        generated_at: new Date().toISOString(),
        window: {
            days: window.days,
            since: new Date(window.sinceMs).toISOString(),
            previousSince: new Date(window.previousSinceMs).toISOString(),
            database: window.databasePath
        },
        totals: {
            runs: runs.length,
            sessions: new Set(runs.map((run) => run.session_id)).size,
            promptRuns: promptRuns.length,
            namingRuns: namingRuns.length,
            turns: turns.length,
            mainTurns: mainTurns.length,
            toolCalls: tools.length
        },
        runs: {
            byOutcome: countBy(runs, (run) => run.outcome),
            byType: countBy(runs, (run) => run.run_type),
            byModel: countBy(
                runs,
                (run) => `${run.provider ?? "unknown"}/${run.model ?? "unknown"}`
            ),
            byVersion: versionMetrics(promptRuns),
            errors: errorBreakdown(runs),
            slowest: promptRuns
                .filter((run) => run.duration_ms !== null)
                .sort((left, right) => Number(right.duration_ms) - Number(left.duration_ms))
                .slice(0, MAX_SLOW_RUNS)
                .map((run) => ({
                    runId: run.run_id,
                    sessionId: run.session_id,
                    startedAt: isoOrNull(run.started_at_ms),
                    durationMs: run.duration_ms,
                    outcome: run.outcome,
                    agentSteps: run.agent_steps,
                    toolCalls: run.tool_calls,
                    model: `${run.provider ?? "unknown"}/${run.model ?? "unknown"}`
                }))
        },
        promptRuns: currentSummary,
        previousWindow: {
            runCount: previousPromptRuns.length,
            promptRuns: previousSummary
        },
        trends: buildTrends(currentSummary, previousSummary),
        findings: buildFindings({
            runs: promptRuns,
            current: currentSummary,
            previous: previousSummary,
            tools: toolSummary,
            dataQuality
        }),
        daily: dailyMetrics(promptRuns),
        llmByModel: llmByModel(completedMainTurns),
        firstTokenKinds: countBy(
            mainTurns,
            (turn) => turn.first_token_kind ?? "unknown"
        ),
        stopReasons: countBy(
            completedMainTurns,
            (turn) => turn.stop_reason ?? "unknown"
        ),
        tools: toolSummary,
        dataQuality
    };
}

function loadRuns(database, sinceMs, beforeMs) {
    return database.prepare(`
        SELECT
            run_id, session_id, run_type, provider, model, permission,
            app_version, build_id, reasoning_level, system_prompt_hash,
            toolset_hash, tool_count, started_at_ms, ended_at_ms, duration_ms,
            active_duration_ms, outcome, error_stage, error_code, prompt_chars,
            history_messages_at_start, context_window, context_tokens_start,
            context_tokens_end, context_utilization_end, llm_turns, tool_calls,
            agent_steps, max_rounds_hit, injected_prompts, tool_errors,
            repeat_tool_calls, permission_requests, permission_wait_ms,
            compactions, compaction_duration_ms, compaction_input_tokens,
            compaction_output_tokens, llm_duration_ms, tool_duration_ms,
            tool_execution_ms, unaccounted_ms, ttft_ms,
            submit_to_first_token_ms, llm_http_attempts, llm_retries,
            rate_limit_responses, retry_after_ms, provider_http_status,
            input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
            reasoning_tokens, cost_usd, tokens_per_second,
            wall_tokens_per_second, final_stop_reason, tool_sequence_json
        FROM runs
        WHERE started_at_ms >= ? AND started_at_ms < ?
        ORDER BY started_at_ms DESC
    `).all(sinceMs, beforeMs);
}

function promptRunMetrics(runs, tools) {
    const durations = numbers(runs.map((run) => run.duration_ms));
    const activeDurations = numbers(runs.map((run) => run.active_duration_ms));
    const llmDurations = numbers(runs.map((run) => run.llm_duration_ms));
    const agentSteps = numbers(runs.map((run) => run.agent_steps));
    const toolCallsPerRun = numbers(runs.map((run) => run.tool_calls));
    const ttft = numbers(runs.map((run) => run.ttft_ms));
    const submitToFirstToken = numbers(
        runs.map((run) => run.submit_to_first_token_ms)
    );
    const tokensPerSecond = numbers(runs.map((run) => run.tokens_per_second));
    const wallTokensPerSecond = numbers(runs.map((run) => run.wall_tokens_per_second));
    const contextUtilization = numbers(runs.map((run) => run.context_utilization_end));
    const unaccounted = numbers(runs.map((run) => run.unaccounted_ms));
    const toolDurations = numbers(tools.map((tool) => tool.duration_ms));
    const permissionWait = numbers(runs.map((run) => run.permission_wait_ms));
    const runCount = runs.length;
    const withToolCalls = runs.filter((run) => Number(run.tool_calls) > 0).length;
    const withCompaction = runs.filter((run) => Number(run.compactions) > 0).length;
    const withInjectedPrompts = runs.filter((run) => Number(run.injected_prompts) > 0).length;
    const maxRounds = runs.filter((run) => Number(run.max_rounds_hit) === 1).length;
    const aborted = runs.filter((run) => run.outcome === "aborted").length;
    const failed = runs.filter((run) => run.outcome === "failed").length;
    const completed = runs.filter((run) => run.outcome === "completed").length;
    const totalToolCalls = sum(runs.map((run) => run.tool_calls));
    const totalAgentSteps = sum(runs.map((run) => run.agent_steps));
    const totalInjectedPrompts = sum(runs.map((run) => run.injected_prompts));
    const totalInput = sum(runs.map((run) => run.input_tokens));
    const totalCacheRead = sum(runs.map((run) => run.cache_read_tokens));
    const totalCacheWrite = sum(runs.map((run) => run.cache_write_tokens));
    const costRuns = runs.filter((run) => run.cost_usd !== null);
    const totalCost = sum(costRuns.map((run) => run.cost_usd));
    const totalToolErrors = sum(runs.map((run) => run.tool_errors));
    const totalDuration = sum(durations);
    const totalPermissionWait = sum(runs.map((run) => run.permission_wait_ms));
    return {
        runCount,
        toolCallRate: percentage(withToolCalls, runCount),
        toolCallsPerRun: totalToolCalls / Math.max(1, runCount),
        toolCallsPerAgentStep: totalToolCalls / Math.max(1, totalAgentSteps),
        toolCallsPerRunStats: describe(toolCallsPerRun),
        agentSteps: describe(agentSteps),
        durationMs: describe(durations),
        activeDurationMs: describe(activeDurations),
        llmDurationMs: describe(llmDurations),
        ttftMs: describe(ttft),
        submitToFirstTokenMs: describe(submitToFirstToken),
        tokensPerSecond: describe(tokensPerSecond),
        wallTokensPerSecond: describe(wallTokensPerSecond),
        toolDurationMs: describe(toolDurations),
        permissionWaitMs: describe(permissionWait),
        unaccountedMs: describe(unaccounted),
        contextUtilization: describe(contextUtilization),
        compactionRate: percentage(withCompaction, runCount),
        injectedPromptRate: percentage(withInjectedPrompts, runCount),
        injectedPromptsPerRun: totalInjectedPrompts / Math.max(1, runCount),
        maxRoundsRate: percentage(maxRounds, runCount),
        completedRate: percentage(completed, runCount),
        failedRate: percentage(failed, runCount),
        abortedRate: percentage(aborted, runCount),
        repeatToolCallRuns: percentage(
            runs.filter((run) => Number(run.repeat_tool_calls) > 0).length,
            runCount
        ),
        permissionRequestRuns: percentage(
            runs.filter((run) => Number(run.permission_requests) > 0).length,
            runCount
        ),
        costPerRun: costRuns.length > 0 ? totalCost / costRuns.length : null,
        costUsd: describe(numbers(costRuns.map((run) => run.cost_usd))),
        outputTokens: describe(numbers(runs.map((run) => run.output_tokens))),
        toolErrorRate: percentage(totalToolErrors, totalToolCalls),
        permissionWaitShare: totalDuration > 0
            ? totalPermissionWait / totalDuration
            : null,
        llmHttpAttempts: sum(runs.map((run) => run.llm_http_attempts)),
        llmRetries: sum(runs.map((run) => run.llm_retries)),
        rateLimitResponses: sum(runs.map((run) => run.rate_limit_responses)),
        retryAfterMs: sum(runs.map((run) => run.retry_after_ms)),
        retryRunRate: percentage(
            runs.filter((run) => Number(run.llm_retries) > 0).length,
            runCount
        ),
        completedWithoutTools: percentage(
            runs.filter(
                (run) => run.outcome === "completed" && Number(run.tool_calls) === 0
            ).length,
            completed
        ),
        cacheReadRatio: totalInput + totalCacheRead + totalCacheWrite > 0
            ? totalCacheRead / (totalInput + totalCacheRead + totalCacheWrite)
            : null
    };
}

function versionMetrics(runs) {
    const groups = new Map();
    for (const run of runs) {
        const key = [
            run.app_version ?? "unknown",
            run.build_id ?? "unknown",
            run.reasoning_level ?? "default",
            run.system_prompt_hash ?? "unknown",
            run.toolset_hash ?? "unknown"
        ].join("|");
        const group = groups.get(key) ?? [];
        group.push(run);
        groups.set(key, group);
    }
    return [...groups.entries()]
        .map(([key, items]) => {
            const [appVersion, buildId, reasoning, promptHash, toolsetHash] = key.split("|");
            const metrics = promptRunMetrics(items, []);
            return {
                appVersion,
                buildId,
                reasoning,
                promptHash,
                toolsetHash,
                runs: items.length,
                completedRate: metrics.completedRate,
                durationMs: metrics.durationMs,
                ttftMs: metrics.ttftMs,
                tokensPerSecond: metrics.tokensPerSecond
            };
        })
        .sort((left, right) => right.runs - left.runs);
}

function dailyMetrics(runs) {
    const groups = new Map();
    for (const run of runs) {
        const key = localDateKey(run.started_at_ms);
        const group = groups.get(key) ?? [];
        group.push(run);
        groups.set(key, group);
    }
    return [...groups.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(-MAX_DAILY_ROWS)
        .map(([date, items]) => {
            const metrics = promptRunMetrics(items, []);
            return {
                date,
                runs: items.length,
                completedRate: metrics.completedRate,
                failedRate: metrics.failedRate,
                durationP50Ms: metrics.durationMs.p50,
                ttftP50Ms: metrics.ttftMs.p50,
                submitToFirstTokenP50Ms: metrics.submitToFirstTokenMs.p50,
                tokensPerSecondP50: metrics.tokensPerSecond.p50,
                toolCallsPerRun: metrics.toolCallsPerRun,
                toolErrorRate: metrics.toolErrorRate,
                permissionWaitShare: metrics.permissionWaitShare,
                costPerRun: metrics.costPerRun
            };
        });
}

function buildTrends(current, previous) {
    return [
        trend("run_count", "Run 数", current.runCount, previous.runCount, false, "count"),
        trend(
            "completed_rate",
            "完成率",
            current.completedRate,
            previous.completedRate,
            false,
            "percent"
        ),
        trend(
            "duration_p50",
            "总时长 p50",
            current.durationMs.p50,
            previous.durationMs.p50,
            true,
            "ms"
        ),
        trend(
            "ttft_p50",
            "TTFT p50",
            current.ttftMs.p50,
            previous.ttftMs.p50,
            true,
            "ms"
        ),
        trend(
            "submit_to_first_token_p50",
            "提交→首 Token p50",
            current.submitToFirstTokenMs.p50,
            previous.submitToFirstTokenMs.p50,
            true,
            "ms"
        ),
        trend(
            "tps_p50",
            "TPS p50",
            current.tokensPerSecond.p50,
            previous.tokensPerSecond.p50,
            false,
            "number"
        ),
        trend(
            "tool_error_rate",
            "工具错误率",
            current.toolErrorRate,
            previous.toolErrorRate,
            true,
            "percent"
        ),
        trend(
            "tool_calls_per_run",
            "工具调用 / Run",
            current.toolCallsPerRun,
            previous.toolCallsPerRun,
            true,
            "number"
        ),
        trend(
            "cost_per_run",
            "成本 / Run",
            current.costPerRun,
            previous.costPerRun,
            true,
            "usd"
        )
    ];
}

function trend(key, label, current, previous, lowerIsBetter, format) {
    return {
        key,
        label,
        current: finiteOrNull(current),
        previous: finiteOrNull(previous),
        change: relativeChange(current, previous),
        lowerIsBetter,
        format
    };
}

function buildFindings({ runs, current, previous, tools, dataQuality }) {
    const findings = [];
    const add = (severity, code, message, value) => {
        findings.push({ severity, code, message, value });
    };
    if (current.runCount >= 10 && current.failedRate > 0.1) {
        add("high", "high_failure_rate", "失败率超过 10%，先检查错误分类和失败阶段。", current.failedRate);
    }
    if (current.runCount >= 10 && current.maxRoundsRate > 0.02) {
        add("high", "max_rounds", "Max rounds 命中率超过 2%，可能存在工具循环或任务无法收敛。", current.maxRoundsRate);
    }
    if (current.runCount >= 10 && current.repeatToolCallRuns > 0.1) {
        add("warning", "repeat_tools", "重复工具调用 Run 占比超过 10%，检查重复调用和参数策略。", current.repeatToolCallRuns);
    }
    if (
        current.runCount >= 10
        && current.permissionWaitShare !== null
        && current.permissionWaitShare > 0.2
    ) {
        add("warning", "permission_wait", "权限等待占总时长超过 20%，需要区分用户等待与真实执行耗时。", current.permissionWaitShare);
    }
    if (current.contextUtilization.p95 !== null && current.contextUtilization.p95 > 0.85) {
        add("warning", "context_pressure", "Context 使用率 p95 超过 85%，压缩和截断风险较高。", current.contextUtilization.p95);
    }
    if (tools.calls >= 20 && current.toolErrorRate > 0.1) {
        add("warning", "tool_errors", "工具错误率超过 10%，查看工具错误分类和截断情况。", current.toolErrorRate);
    }
    if (current.runCount >= 10 && current.retryRunRate > 0.1) {
        add("warning", "provider_retries", "发生 LLM HTTP 重试的 Run 超过 10%，检查限流、网络和 provider 状态。", current.retryRunRate);
    }
    if (current.llmRetries > 0) {
        add("info", "retry_count", `本窗口共发生 ${current.llmRetries} 次 LLM HTTP 重试。`, current.llmRetries);
    }
    const p50DurationChange = relativeChange(
        current.durationMs.p50,
        previous.durationMs.p50
    );
    if (
        current.runCount >= 10
        && previous.runCount >= 10
        && p50DurationChange !== null
        && p50DurationChange > 0.2
    ) {
        add("warning", "duration_regression", "总时长 p50 较上一窗口上升超过 20%。", p50DurationChange);
    }
    const p50TtftChange = relativeChange(
        current.ttftMs.p50,
        previous.ttftMs.p50
    );
    if (
        current.runCount >= 10
        && previous.runCount >= 10
        && p50TtftChange !== null
        && p50TtftChange > 0.2
    ) {
        add("warning", "ttft_regression", "TTFT p50 较上一窗口上升超过 20%。", p50TtftChange);
    }
    const qualityChecks = [
        ["TTFT", dataQuality.promptRunsMissingTtft],
        ["提交→首 Token", dataQuality.promptRunsMissingFirstToken],
        ["Token Usage", dataQuality.promptRunsMissingUsage],
        ["Cost", dataQuality.promptRunsMissingCost],
        ["App Version", dataQuality.promptRunsMissingAppVersion],
        ["System Prompt Hash", dataQuality.promptRunsMissingPromptHash],
        ["Toolset Hash", dataQuality.promptRunsMissingToolsetHash]
    ];
    for (const [label, check] of qualityChecks) {
        if (check.total >= 10 && check.count / check.total > 0.2) {
            add(
                "info",
                "data_quality",
                `${label} 缺失超过 20%，当前统计的代表性有限。`,
                check.count / check.total
            );
            break;
        }
    }
    if (tools.calls >= 20 && tools.errorRate > 0.1) {
        add("warning", "tool_regression", "工具调用错误率偏高，优先查看错误分类。", tools.errorRate);
    }
    return findings;
}

function relativeChange(current, previous) {
    if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) {
        return null;
    }
    return (current - previous) / Math.abs(previous);
}

function finiteOrNull(value) {
    return Number.isFinite(value) ? value : null;
}

function localDateKey(ms) {
    const date = new Date(Number(ms));
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function llmByModel(turns) {
    const groups = new Map();
    for (const turn of turns) {
        const key = `${turn.provider ?? "unknown"}/${turn.model ?? "unknown"}`;
        const group = groups.get(key) ?? [];
        group.push(turn);
        groups.set(key, group);
    }
    return [...groups.entries()]
        .map(([model, items]) => ({
            model,
            turns: items.length,
            ttftMs: describe(numbers(items.map((turn) => turn.ttft_ms))),
            tokensPerSecond: describe(numbers(items.map((turn) => turn.tokens_per_second))),
            durationMs: describe(numbers(items.map((turn) => turn.duration_ms))),
            outputTokens: sum(items.map((turn) => turn.output_tokens)),
            inputTokens: sum(items.map((turn) => turn.input_tokens)),
            llmHttpAttempts: sum(items.map((turn) => turn.llm_http_attempts)),
            llmRetries: sum(items.map((turn) => turn.llm_retries)),
            rateLimitResponses: sum(
                items.map((turn) => turn.rate_limit_responses)
            )
        }))
        .sort((left, right) => right.turns - left.turns);
}

function toolMetrics(tools) {
    const groups = new Map();
    for (const tool of tools) {
        const group = groups.get(tool.tool_name) ?? [];
        group.push(tool);
        groups.set(tool.tool_name, group);
    }
    const byName = [...groups.entries()].map(([name, items]) => {
        const successes = items.filter((tool) => tool.outcome === "success").length;
        const errors = items.filter((tool) => tool.outcome === "error").length;
        const cancelled = items.filter((tool) => tool.outcome === "cancelled").length;
        return {
            name,
            category: items[0]?.tool_category ?? "unknown",
            calls: items.length,
            successes,
            errors,
            cancelled,
            errorRate: percentage(errors, successes + errors),
            durationMs: describe(numbers(items.map((tool) => tool.duration_ms))),
            executionMs: describe(numbers(items.map((tool) => tool.execution_ms))),
            permissionRequests: sum(items.map((tool) => tool.permission_requests)),
            permissionWaitMs: sum(items.map((tool) => tool.permission_wait_ms)),
            averageOutputBytes: average(numbers(items.map((tool) => tool.output_bytes))),
            repeatRate: percentage(
                items.filter((tool) => Number(tool.repeat_index) > 0).length,
                items.length
            ),
            truncatedRate: percentage(
                items.filter((tool) => Number(tool.truncated) === 1).length,
                items.length
            ),
            emptyOutputRate: percentage(
                items.filter(
                    (tool) => tool.output_chars !== null
                        && Number(tool.output_chars) === 0
                        && Number(tool.image_count) === 0
                ).length,
                items.length
            )
        };
    }).sort((left, right) => right.calls - left.calls);
    const successes = tools.filter((tool) => tool.outcome === "success").length;
    const errors = tools.filter((tool) => tool.outcome === "error").length;
    const cancelled = tools.filter((tool) => tool.outcome === "cancelled").length;
    return {
        calls: tools.length,
        successes,
        errors,
        cancelled,
        errorRate: percentage(errors, successes + errors),
        byName,
        byCategory: countBy(tools, (tool) => tool.tool_category),
        errorsByCode: countBy(
            tools.filter((tool) => tool.outcome === "error"),
            (tool) => tool.error_code ?? "unknown"
        )
    };
}

function errorBreakdown(runs) {
    const groups = new Map();
    for (const run of runs) {
        if (!run.error_stage && !run.error_code) {
            continue;
        }
        const key = `${run.error_stage ?? "unknown"}/${run.error_code ?? "unknown"}`;
        groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    return [...groups.entries()]
        .map(([error, count]) => ({ error, count }))
        .sort((left, right) => right.count - left.count);
}

function describe(values) {
    if (values.length === 0) {
        return { n: 0, p50: null, p95: null, max: null };
    }
    return {
        n: values.length,
        p50: percentile(values, 0.5),
        p95: values.length >= MIN_P95_SAMPLES ? percentile(values, 0.95) : null,
        max: Math.max(...values)
    };
}

function percentile(values, quantile) {
    if (values.length === 0) {
        return null;
    }
    const sorted = [...values].sort((left, right) => left - right);
    const position = (sorted.length - 1) * quantile;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    const value = lower === upper
        ? sorted[lower]
        : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
    return round(value);
}

function numbers(values) {
    return values
        .filter((value) => value !== null && value !== undefined)
        .map(Number)
        .filter(Number.isFinite);
}

function sum(values) {
    return numbers(values).reduce((total, value) => total + value, 0);
}

function average(values) {
    return values.length === 0 ? null : round(sum(values) / values.length);
}

function percentage(part, total) {
    return total <= 0 ? 0 : part / total;
}

function missingMetric(runs, key) {
    return {
        count: runs.filter((run) => run[key] === null || run[key] === undefined).length,
        total: runs.length
    };
}

function countBy(items, keyFor) {
    const counts = new Map();
    for (const item of items) {
        const key = keyFor(item);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
        .map(([key, count]) => ({ key, count }))
        .sort((left, right) => right.count - left.count);
}

function round(value) {
    return Math.round(value * 100) / 100;
}

function isoOrNull(value) {
    return value === null || value === undefined
        ? null
        : new Date(Number(value)).toISOString();
}

function renderMarkdown(report) {
    const lines = [];
    lines.push("# Agent observability report");
    lines.push("");
    lines.push(`- 时间范围：最近 ${report.window.days} 天（${report.window.since} 起）`);
    lines.push(`- 对比窗口：${report.window.previousSince} 至 ${report.window.since}`);
    lines.push(`- 数据库：\`${report.window.database}\``);
    lines.push(`- 生成时间：${report.generated_at}`);
    lines.push("");
    lines.push("## 总览");
    lines.push("");
    lines.push("| 指标 | 值 |");
    lines.push("| --- | ---: |");
    lines.push(`| Run 数 | ${report.totals.runs} |`);
    lines.push(`| Session 数 | ${report.totals.sessions} |`);
    lines.push(`| Prompt Run | ${report.totals.promptRuns} |`);
    lines.push(`| Naming Run | ${report.totals.namingRuns} |`);
    lines.push(`| Main LLM Turn | ${report.totals.mainTurns} |`);
    lines.push(`| 工具调用 | ${report.totals.toolCalls} |`);
    lines.push("");
    lines.push("## Run 状态");
    lines.push("");
    lines.push("| 状态 | 数量 |");
    lines.push("| --- | ---: |");
    for (const item of report.runs.byOutcome) {
        lines.push(`| ${item.key} | ${item.count} |`);
    }
    lines.push("");
    lines.push("## 自动发现");
    lines.push("");
    if (report.findings.length === 0) {
        lines.push("- 当前窗口未触发内置异常阈值。");
    } else {
        for (const finding of report.findings) {
            lines.push(`- [${finding.severity}] ${finding.message}`);
        }
    }
    lines.push("");
    lines.push("## Prompt Run");
    lines.push("");
    lines.push("| 指标 | 值 |");
    lines.push("| --- | ---: |");
    const prompt = report.promptRuns;
    lines.push(`| 工具调用率 | ${pct(prompt.toolCallRate)} |`);
    lines.push(`| 工具调用 / Run | ${num(prompt.toolCallsPerRun)} |`);
    lines.push(`| 工具调用 / Agent Step | ${num(prompt.toolCallsPerAgentStep)} |`);
    lines.push(`| Agent Steps p50 / p95 | ${stat(prompt.agentSteps, 0)} |`);
    lines.push(`| 总时长 p50 / p95 | ${statMs(prompt.durationMs)} |`);
    lines.push(`| 活跃时长 p50 / p95 | ${statMs(prompt.activeDurationMs)} |`);
    lines.push(`| LLM 时长 p50 / p95 | ${statMs(prompt.llmDurationMs)} |`);
    lines.push(`| TTFT p50 / p95 | ${statMs(prompt.ttftMs)} |`);
    lines.push(`| 提交→首 Token p50 / p95 | ${statMs(prompt.submitToFirstTokenMs)} |`);
    lines.push(`| TPS p50 / p95 | ${stat(prompt.tokensPerSecond, 2)} |`);
    lines.push(`| Wall TPS p50 / p95 | ${stat(prompt.wallTokensPerSecond, 2)} |`);
    lines.push(`| 工具耗时 p50 / p95 | ${statMs(prompt.toolDurationMs)} |`);
    lines.push(`| 权限等待 p50 / p95 | ${statMs(prompt.permissionWaitMs)} |`);
    lines.push(`| 未归因时长 p50 / p95 | ${statMs(prompt.unaccountedMs)} |`);
    lines.push(`| Context 使用率 p50 / p95 | ${statPct(prompt.contextUtilization)} |`);
    lines.push(`| 压缩触发率 | ${pct(prompt.compactionRate)} |`);
    lines.push(`| Prompt 注入率 / 平均注入数 | ${pct(prompt.injectedPromptRate)} / ${num(prompt.injectedPromptsPerRun)} |`);
    lines.push(`| Max Rounds 命中率 | ${pct(prompt.maxRoundsRate)} |`);
    lines.push(`| 完成 / 失败 / 中止 | ${pct(prompt.completedRate)} / ${pct(prompt.failedRate)} / ${pct(prompt.abortedRate)} |`);
    lines.push(`| 重复工具调用 Run 占比 | ${pct(prompt.repeatToolCallRuns)} |`);
    lines.push(`| 权限请求 Run 占比 | ${pct(prompt.permissionRequestRuns)} |`);
    lines.push(`| 无工具完成率 | ${pct(prompt.completedWithoutTools)} |`);
    lines.push(`| LLM HTTP 尝试 / 重试 / 429 | ${num(prompt.llmHttpAttempts)} / ${num(prompt.llmRetries)} / ${num(prompt.rateLimitResponses)} |`);
    lines.push(`| Retry-After 累计 | ${num(prompt.retryAfterMs)} ms |`);
    lines.push(`| 发生重试 Run 占比 | ${pct(prompt.retryRunRate)} |`);
    lines.push(`| 工具错误率 | ${pct(prompt.toolErrorRate)} |`);
    lines.push(`| 权限等待时长占比 | ${pct(prompt.permissionWaitShare)} |`);
    lines.push(`| 平均成本 / Run | ${usd(prompt.costPerRun)} |`);
    lines.push(`| 成本 p50 / p95 | ${statUsd(prompt.costUsd)} |`);
    lines.push(`| Output Tokens p50 / p95 | ${stat(prompt.outputTokens, 0)} |`);
    lines.push(`| Cache Read 占比 | ${pct(prompt.cacheReadRatio)} |`);
    lines.push("");
    lines.push("## 环比趋势");
    lines.push("");
    lines.push("| 指标 | 当前窗口 | 上一窗口 | 变化 |");
    lines.push("| --- | ---: | ---: | ---: |");
    for (const item of report.trends) {
        lines.push(`| ${item.label} | ${formatTrendValue(item, item.current)} | ${formatTrendValue(item, item.previous)} | ${formatChange(item.change)} |`);
    }
    lines.push("");
    lines.push("## 每日趋势");
    lines.push("");
    lines.push("| 日期 | Runs | 完成率 | 失败率 | 时长 p50 | TTFT p50 | 提交→首 Token p50 | TPS p50 | 工具错误率 | 权限等待占比 | 成本/Run |");
    lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const day of report.daily) {
        lines.push(`| ${day.date} | ${day.runs} | ${pct(day.completedRate)} | ${pct(day.failedRate)} | ${fixed(day.durationP50Ms, 1)} ms | ${fixed(day.ttftP50Ms, 1)} ms | ${fixed(day.submitToFirstTokenP50Ms, 1)} ms | ${fixed(day.tokensPerSecondP50, 2)} | ${pct(day.toolErrorRate)} | ${pct(day.permissionWaitShare)} | ${usd(day.costPerRun)} |`);
    }
    if (report.daily.length === 0) {
        lines.push("| 暂无数据 | 0 | - | - | - | - | - | - | - | - | - |");
    }
    lines.push("");
    lines.push("## 版本分组");
    lines.push("");
    lines.push("| App | Build | Reasoning | Prompt | Toolset | Runs | 完成率 | 时长 p50 | TTFT p50 | TPS p50 |");
    lines.push("| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |");
    for (const version of report.runs.byVersion.slice(0, 12)) {
        lines.push(`| ${escapeTable(version.appVersion)} | ${escapeTable(version.buildId)} | ${escapeTable(version.reasoning)} | \`${version.promptHash}\` | \`${version.toolsetHash}\` | ${version.runs} | ${pct(version.completedRate)} | ${fixed(version.durationMs.p50, 1)} ms | ${fixed(version.ttftMs.p50, 1)} ms | ${fixed(version.tokensPerSecond.p50, 2)} |`);
    }
    if (report.runs.byVersion.length === 0) {
        lines.push("| 暂无数据 | - | - | - | - | 0 | - | - | - | - |");
    }
    lines.push("");
    lines.push("## LLM 分模型");
    lines.push("");
    lines.push("| 模型 | Turns | TTFT p50 / p95 | TPS p50 / p95 | 时长 p50 / p95 | HTTP 尝试 / 重试 / 429 | Output Tokens |");
    lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const item of report.llmByModel) {
        lines.push(`| ${escapeTable(item.model)} | ${item.turns} | ${statMs(item.ttftMs)} | ${stat(item.tokensPerSecond, 2)} | ${statMs(item.durationMs)} | ${num(item.llmHttpAttempts)} / ${num(item.llmRetries)} / ${num(item.rateLimitResponses)} | ${item.outputTokens} |`);
    }
    if (report.llmByModel.length === 0) {
        lines.push("| 暂无数据 | 0 | - | - | - | 0 / 0 / 0 | 0 |");
    }
    lines.push("");
    lines.push("## 工具");
    lines.push("");
    const toolSummary = report.tools;
    lines.push(`- 调用：${toolSummary.calls}，成功：${toolSummary.successes}，失败：${toolSummary.errors}，取消：${toolSummary.cancelled}，错误率：${pct(toolSummary.errorRate)}`);
    lines.push(`- 首字类型：${formatCounts(report.firstTokenKinds)}`);
    lines.push(`- 停止原因：${formatCounts(report.stopReasons)}`);
    lines.push("");
    lines.push("| 工具 | 分类 | 调用 | 错误率 | Duration p50 / p95 | Execution p50 / p95 | 权限等待 | 重复率 | 截断率 | 空输出率 |");
    lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const tool of toolSummary.byName) {
        lines.push(`| ${escapeTable(tool.name)} | ${tool.category} | ${tool.calls} | ${pct(tool.errorRate)} | ${statMs(tool.durationMs)} | ${statMs(tool.executionMs)} | ${num(tool.permissionWaitMs)} ms | ${pct(tool.repeatRate)} | ${pct(tool.truncatedRate)} | ${pct(tool.emptyOutputRate)} |`);
    }
    if (toolSummary.byName.length === 0) {
        lines.push("| 暂无数据 | - | 0 | - | - | - | 0 ms | - | - | - |");
    }
    lines.push("");
    lines.push("## 错误");
    lines.push("");
    if (report.runs.errors.length === 0) {
        lines.push("- 无");
    } else {
        for (const error of report.runs.errors) {
            lines.push(`- ${error.error}: ${error.count}`);
        }
    }
    lines.push("");
    lines.push("## 最慢 Prompt Run");
    lines.push("");
    lines.push("| Run | Session | 时间 | 模型 | 时长 | 状态 | Steps | Tools |");
    lines.push("| --- | --- | --- | --- | ---: | --- | ---: | ---: |");
    for (const run of report.runs.slowest) {
        lines.push(`| \`${run.runId}\` | \`${run.sessionId}\` | ${run.startedAt ?? "-"} | ${escapeTable(run.model)} | ${num(run.durationMs)} ms | ${run.outcome} | ${run.agentSteps} | ${run.toolCalls} |`);
    }
    if (report.runs.slowest.length === 0) {
        lines.push("| 暂无数据 | - | - | - | 0 ms | - | 0 | 0 |");
    }
    lines.push("");
    lines.push("## 数据质量");
    lines.push("");
    lines.push(`- Prompt Run 缺少 TTFT：${report.dataQuality.promptRunsMissingTtft.count}/${report.dataQuality.promptRunsMissingTtft.total}`);
    lines.push(`- Prompt Run 缺少 提交→首 Token：${report.dataQuality.promptRunsMissingFirstToken.count}/${report.dataQuality.promptRunsMissingFirstToken.total}`);
    lines.push(`- Prompt Run 缺少 Token Usage：${report.dataQuality.promptRunsMissingUsage.count}/${report.dataQuality.promptRunsMissingUsage.total}`);
    lines.push(`- Prompt Run 缺少 Cost：${report.dataQuality.promptRunsMissingCost.count}/${report.dataQuality.promptRunsMissingCost.total}`);
    lines.push(`- Prompt Run 缺少 App Version：${report.dataQuality.promptRunsMissingAppVersion.count}/${report.dataQuality.promptRunsMissingAppVersion.total}`);
    lines.push(`- Prompt Run 缺少 System Prompt Hash：${report.dataQuality.promptRunsMissingPromptHash.count}/${report.dataQuality.promptRunsMissingPromptHash.total}`);
    lines.push(`- Prompt Run 缺少 Toolset Hash：${report.dataQuality.promptRunsMissingToolsetHash.count}/${report.dataQuality.promptRunsMissingToolsetHash.total}`);
    lines.push(`- Main Turn 缺少 TTFT：${report.dataQuality.mainTurnsMissingTtft.count}/${report.dataQuality.mainTurnsMissingTtft.total}`);
    lines.push(`- Main Turn 缺少 Token Usage：${report.dataQuality.mainTurnsMissingUsage.count}/${report.dataQuality.mainTurnsMissingUsage.total}`);
    lines.push(`- 仍未结束：Run ${report.dataQuality.runsStillRunning}，Turn ${report.dataQuality.turnsStillRunning}，Tool ${report.dataQuality.toolsStillRunning}`);
    lines.push(`- 统计规则：${report.dataQuality.p95Rule}`);
    lines.push("");
    return `${lines.join("\n")}\n`;
}

function stat(stats, digits) {
    if (!stats || stats.n === 0) {
        return "-";
    }
    return `${fixed(stats.p50, digits)} / ${stats.p95 === null ? `n<${MIN_P95_SAMPLES}` : fixed(stats.p95, digits)}`;
}

function statMs(stats) {
    return stats && stats.n > 0
        ? `${fixed(stats.p50, 1)} / ${stats.p95 === null ? `n<${MIN_P95_SAMPLES}` : fixed(stats.p95, 1)} ms`
        : "-";
}

function statPct(stats) {
    if (!stats || stats.n === 0) {
        return "-";
    }
    return `${fixed(stats.p50 * 100, 1)}% / ${stats.p95 === null ? `n<${MIN_P95_SAMPLES}` : `${fixed(stats.p95 * 100, 1)}%`}`;
}

function statUsd(stats) {
    if (!stats || stats.n === 0) {
        return "-";
    }
    return `${usd(stats.p50)} / ${stats.p95 === null ? `n<${MIN_P95_SAMPLES}` : usd(stats.p95)}`;
}

function formatTrendValue(item, value) {
    if (value === null || value === undefined) {
        return "-";
    }
    switch (item.format) {
        case "percent":
            return pct(value);
        case "ms":
            return `${fixed(value, 1)} ms`;
        case "usd":
            return usd(value);
        case "count":
            return num(value);
        default:
            return fixed(value, 2);
    }
}

function formatChange(change) {
    if (change === null || change === undefined) {
        return "-";
    }
    const prefix = change > 0 ? "+" : "";
    return `${prefix}${fixed(change * 100, 1)}%`;
}

function fixed(value, digits) {
    return value === null || value === undefined
        ? "-"
        : Number(value).toFixed(digits);
}

function pct(value) {
    return value === null || value === undefined
        ? "-"
        : `${(value * 100).toFixed(1)}%`;
}

function num(value) {
    return value === null || value === undefined
        ? "-"
        : Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function usd(value) {
    return value === null || value === undefined
        ? "-"
        : `$${Number(value).toFixed(4)}`;
}

function formatCounts(items) {
    return items.length === 0
        ? "-"
        : items.map((item) => `${item.key}=${item.count}`).join(", ");
}

function escapeTable(value) {
    return String(value).replaceAll("|", "\\|");
}

function parseArguments(args) {
    const parsed = {
        days: 7,
        format: "markdown",
        databasePath: undefined,
        help: false
    };
    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === "--help" || argument === "-h") {
            parsed.help = true;
            continue;
        }
        if (argument === "--days") {
            parsed.days = positiveInteger(args[++index], "--days");
            continue;
        }
        if (argument === "--format") {
            parsed.format = args[++index] ?? "";
            if (parsed.format !== "markdown" && parsed.format !== "json") {
                throw new Error("--format must be markdown or json");
            }
            continue;
        }
        if (argument === "--db") {
            parsed.databasePath = args[++index];
            if (!parsed.databasePath) {
                throw new Error("--db requires a path");
            }
            continue;
        }
        throw new Error(`Unknown argument: ${argument}`);
    }
    return parsed;
}

function positiveInteger(value, name) {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }
    return number;
}

function printHelp() {
    console.log(`Usage: node scripts/agent-report.mjs [options]

Options:
  --days <n>          Reporting window in days (default: 7)
  --format <format>   markdown or json (default: markdown)
  --db <path>         SQLite database path
  -h, --help          Show this help
`);
}
