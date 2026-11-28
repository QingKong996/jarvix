import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { type JarvixLogger, noopLogger } from "../../core/logger.ts";
import type { JarvixConfig } from "../../protocol/config.ts";
import type { JarvixContextUsagePoint } from "../../protocol/provider-context.ts";
import type { ModelCost } from "../../protocol/providers.ts";
import type {
    UsageAuditQuery,
    UsageOutcome,
    UsagePeriod,
    UsageRequest,
    UsageStats,
    UsageTurnKind
} from "../../protocol/usage.ts";
import { calculateUsageCost, hasModelPrices } from "./usage-pricing.ts";

type UsageStatsServiceOptions = {
    databasePath: string;
    getConfig(): JarvixConfig;
    now?: () => number;
    logger?: JarvixLogger;
};

type UsageRow = {
    turn_id: string;
    session_id: string;
    turn_kind: UsageTurnKind;
    provider: string | null;
    model: string | null;
    started_at_ms: number;
    duration_ms: number | null;
    ttft_ms: number | null;
    generation_ms: number | null;
    outcome: UsageOutcome;
    input_tokens: number | null;
    output_tokens: number | null;
    cache_read_tokens: number | null;
    cache_write_tokens: number | null;
    cost_usd: number | null;
    tokens_per_second: number | null;
    llm_http_attempts: number | null;
    llm_retries: number | null;
    received_text_chars: number | null;
    received_thinking_chars: number | null;
    error_code: string | null;
};

type ContextUsageRow = {
    step_index: number;
    started_at_ms: number;
    context_tokens_before: number | null;
    context_tokens_after: number | null;
};

type UsageWindow = {
    fromMs: number;
    toMs: number;
};

type UsageTokenValues = Pick<
    UsageRequest,
    | "inputTokens"
    | "outputTokens"
    | "cacheReadTokens"
    | "cacheWriteTokens"
>;

const USAGE_ROWS_SQL = `
    SELECT
        turn_id, session_id, turn_kind, provider, model,
        started_at_ms, duration_ms, ttft_ms, generation_ms, outcome,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
        cost_usd, tokens_per_second, llm_http_attempts, llm_retries,
        received_text_chars, received_thinking_chars, error_code
    FROM turns
    WHERE outcome != 'running' AND started_at_ms >= ? AND started_at_ms < ?
    ORDER BY started_at_ms DESC
`;

const CONTEXT_USAGE_ROWS_SQL = `
    SELECT
        step_index, started_at_ms,
        context_tokens_before, context_tokens_after
    FROM (
        SELECT
            ROW_NUMBER() OVER (
                ORDER BY started_at_ms, turn_id
            ) AS step_index,
            started_at_ms,
            context_tokens_before,
            context_tokens_after
        FROM turns
        WHERE session_id = ?
            AND turn_kind = 'main'
            AND (
                context_tokens_before IS NOT NULL
                OR context_tokens_after IS NOT NULL
            )
    )
    ORDER BY step_index DESC
    LIMIT ?
`;

export class UsageStatsService {
    private readonly databasePath: string;
    private readonly getConfig: () => JarvixConfig;
    private readonly now: () => number;
    private readonly logger: JarvixLogger;

    constructor(options: UsageStatsServiceOptions) {
        this.databasePath = options.databasePath;
        this.getConfig = options.getConfig;
        this.now = options.now ?? Date.now;
        this.logger = options.logger ?? noopLogger;
    }

    stats(query: UsageAuditQuery): UsageStats {
        const now = this.now();
        const requestedWindow = usageWindow(query, now);
        if (!existsSync(this.databasePath)) {
            return emptyStats(query.period, requestedWindow);
        }

        let database: DatabaseSync | undefined;
        try {
            database = new DatabaseSync(this.databasePath, { readOnly: true });
            database.exec("PRAGMA busy_timeout = 1000");
            const rows = database.prepare(USAGE_ROWS_SQL).all(
                requestedWindow.fromMs,
                requestedWindow.toMs
            ) as unknown as UsageRow[];
            const window = query.period === "all"
                ? allPeriodWindow(rows, now)
                : requestedWindow;
            const config = this.getConfig();
            return {
                period: query.period,
                fromMs: window.fromMs,
                toMs: window.toMs,
                requests: rows.map((row) => usageRequest(row, config))
            };
        } catch (error) {
            this.logger.warn("Usage statistics query failed", {
                reason: error instanceof Error ? error.message : String(error)
            });
            return emptyStats(query.period, requestedWindow);
        } finally {
            database?.close();
        }
    }

    contextHistory(
        sessionId: string,
        limit = 60
    ): JarvixContextUsagePoint[] {
        if (!existsSync(this.databasePath)) {
            return [];
        }

        let database: DatabaseSync | undefined;
        try {
            database = new DatabaseSync(this.databasePath, { readOnly: true });
            database.exec("PRAGMA busy_timeout = 1000");
            const rows = database.prepare(CONTEXT_USAGE_ROWS_SQL).all(
                sessionId,
                Math.max(1, Math.min(200, Math.round(limit)))
            ) as unknown as ContextUsageRow[];
            return rows.reverse().flatMap(contextUsagePoint);
        } catch (error) {
            this.logger.warn("Context usage history query failed", {
                sessionId,
                reason: error instanceof Error ? error.message : String(error)
            });
            return [];
        } finally {
            database?.close();
        }
    }
}

function usageRequest(row: UsageRow, config: JarvixConfig): UsageRequest {
    const tokens = tokenCounts(row);
    const pricing = findConfiguredPricing(config, row.provider, row.model);
    return {
        turnId: row.turn_id,
        sessionId: row.session_id,
        turnKind: row.turn_kind,
        provider: row.provider ?? "",
        model: row.model ?? "",
        startedAtMs: numberValue(row.started_at_ms),
        durationMs: numberValue(row.duration_ms),
        ttftMs: numberValue(row.ttft_ms),
        generationMs: numberValue(row.generation_ms),
        outcome: row.outcome,
        ...tokens,
        totalTokens: totalTokens(tokens),
        costUsd: pricing && hasModelPrices(pricing)
            ? calculateUsageCost(pricing, tokens)
            : numberValue(row.cost_usd),
        tokensPerSecond: numberValue(row.tokens_per_second),
        httpAttempts: numberValue(row.llm_http_attempts),
        retries: numberValue(row.llm_retries),
        receivedTextChars: numberValue(row.received_text_chars),
        receivedThinkingChars: numberValue(row.received_thinking_chars),
        errorCode: row.error_code
    };
}

function tokenCounts(row: UsageRow): UsageTokenValues {
    return {
        inputTokens: numberValue(row.input_tokens),
        outputTokens: numberValue(row.output_tokens),
        cacheReadTokens: numberValue(row.cache_read_tokens),
        cacheWriteTokens: numberValue(row.cache_write_tokens)
    };
}

function findConfiguredPricing(
    config: JarvixConfig,
    provider: string | null,
    model: string | null
): ModelCost | undefined {
    if (!provider || !model) return undefined;
    return config.providers
        ?.find((entry) => entry.id === provider)
        ?.models.find((entry) => entry.id === model)
        ?.cost;
}

function totalTokens(usage: UsageTokenValues): number {
    return usage.inputTokens
        + usage.outputTokens
        + usage.cacheReadTokens
        + usage.cacheWriteTokens;
}

function numberValue(value: number | null): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function contextUsagePoint(row: ContextUsageRow): JarvixContextUsagePoint[] {
    const step = Number.isSafeInteger(row.step_index) && row.step_index > 0
        ? row.step_index
        : null;
    const estimatedTokens = nullableTokenCount(row.context_tokens_before)
        ?? nullableTokenCount(row.context_tokens_after);
    if (step === null || estimatedTokens === null) {
        return [];
    }
    return [{
        step,
        atMs: numberValue(row.started_at_ms),
        estimatedTokens
    }];
}

function nullableTokenCount(value: number | null): number | null {
    return typeof value === "number" && Number.isFinite(value) && value >= 0
        ? Math.round(value)
        : null;
}

function emptyStats(period: UsagePeriod, window: UsageWindow): UsageStats {
    return {
        period,
        fromMs: window.fromMs,
        toMs: window.toMs,
        requests: []
    };
}

export function usageWindow(query: UsageAuditQuery, nowMs: number): UsageWindow {
    const today = startOfLocalDay(nowMs);
    switch (query.period) {
        case "today":
            return {
                fromMs: today,
                toMs: addLocalDays(today, 1)
            };
        case "24h":
            return {
                fromMs: nowMs - 24 * 60 * 60 * 1_000,
                toMs: nowMs
            };
        case "7d":
            return {
                fromMs: addLocalDays(today, -6),
                toMs: addLocalDays(today, 1)
            };
        case "30d":
            return {
                fromMs: addLocalDays(today, -29),
                toMs: addLocalDays(today, 1)
            };
        case "custom":
            return {
                fromMs: query.fromMs ?? addLocalDays(today, -6),
                toMs: query.toMs ?? addLocalDays(today, 1)
            };
        case "all":
            return {
                fromMs: 0,
                toMs: nowMs + 1
            };
    }
}

function allPeriodWindow(rows: readonly UsageRow[], nowMs: number): UsageWindow {
    if (rows.length === 0) {
        const today = startOfLocalDay(nowMs);
        return {
            fromMs: today,
            toMs: addLocalDays(today, 1)
        };
    }
    const earliest = Math.min(...rows.map((row) => row.started_at_ms));
    const today = startOfLocalDay(nowMs);
    return {
        fromMs: startOfLocalDay(earliest),
        toMs: addLocalDays(today, 1)
    };
}

function startOfLocalDay(ms: number): number {
    const date = new Date(ms);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function addLocalDays(ms: number, days: number): number {
    const date = new Date(ms);
    return new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate() + days
    ).getTime();
}
