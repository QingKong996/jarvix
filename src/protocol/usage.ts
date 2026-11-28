import { z } from "zod";

export const USAGE_PERIODS = [
    "today",
    "24h",
    "7d",
    "30d",
    "all",
    "custom"
] as const;
export type UsagePeriod = (typeof USAGE_PERIODS)[number];

export type UsageTurnKind = "main" | "compaction" | "naming";
export type UsageOutcome = "completed" | "error" | "aborted";

export type UsageAuditQuery = {
    period: UsagePeriod;
    fromMs?: number;
    toMs?: number;
};

export const usageAuditQuerySchema = z.object({
    period: z.enum(USAGE_PERIODS),
    fromMs: z.number().int().nonnegative().optional(),
    toMs: z.number().int().positive().optional()
}).superRefine((query, context) => {
    if (query.period !== "custom") {
        return;
    }
    if (query.fromMs === undefined || query.toMs === undefined) {
        context.addIssue({
            code: "custom",
            message: "Custom usage period requires a start and end"
        });
        return;
    }
    if (query.toMs <= query.fromMs) {
        context.addIssue({
            code: "custom",
            message: "Custom usage period end must be after its start"
        });
    }
});

export type UsageRequest = {
    turnId: string;
    sessionId: string;
    turnKind: UsageTurnKind;
    provider: string;
    model: string;
    startedAtMs: number;
    durationMs: number;
    ttftMs: number;
    generationMs: number;
    outcome: UsageOutcome;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
    costUsd: number;
    tokensPerSecond: number;
    httpAttempts: number;
    retries: number;
    receivedTextChars: number;
    receivedThinkingChars: number;
    errorCode: string | null;
};

export type UsageStats = {
    period: UsagePeriod;
    fromMs: number;
    toMs: number;
    requests: UsageRequest[];
};
