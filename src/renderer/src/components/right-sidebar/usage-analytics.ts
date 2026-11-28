import type {
    UsagePeriod,
    UsageRequest
} from "../../../../protocol/usage.ts";

export const USAGE_METRICS = [
    "tokens",
    "cost",
    "requests",
    "speed",
    "traffic"
] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];

export type UsageSummary = {
    requests: number;
    failed: number;
    cancelled: number;
    retried: number;
    successRate: number;
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
    totalTokens: number;
    costUsd: number;
    cacheHitRate: number;
    ttftSamples: number;
    averageTtftMs: number;
    speedSamples: number;
    averageTokensPerSecond: number;
    textChars: number;
    thinkingChars: number;
    responseChars: number;
    averageCharsPerSecond: number;
};

export type UsageLabels = {
    modelNames: ReadonlyMap<string, string>;
    providerNames: ReadonlyMap<string, string>;
    sessionNames: ReadonlyMap<string, string>;
    unknownModel: string;
    unknownProvider: string;
    unknownAgent: string;
};

type UsageBucketGrain = "hour" | "day" | "week" | "month";

type UsageBucket = {
    startMs: number;
    endMs: number;
    label: string;
    grain: UsageBucketGrain;
};

export type UsageChartPoint = {
    startMs: number;
    endMs: number;
    label: string;
    grain: UsageBucketGrain;
    value: number;
};

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;

export function usageModelKey(provider: string, model: string): string {
    return `${provider}\0${model}`;
}

export function summarizeUsage(requests: readonly UsageRequest[]): UsageSummary {
    const summary: UsageSummary = {
        requests: 0,
        failed: 0,
        cancelled: 0,
        retried: 0,
        successRate: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        cacheHitRate: 0,
        ttftSamples: 0,
        averageTtftMs: 0,
        speedSamples: 0,
        averageTokensPerSecond: 0,
        textChars: 0,
        thinkingChars: 0,
        responseChars: 0,
        averageCharsPerSecond: 0
    };
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;
    let ttftTotalMs = 0;
    let generationMs = 0;
    let durationMs = 0;

    for (const request of requests) {
        summary.requests += 1;
        if (request.outcome === "completed") {
            if (request.retries > 0) {
                summary.retried += 1;
            }
        } else if (request.outcome === "error") {
            summary.failed += 1;
        } else {
            summary.cancelled += 1;
        }
        summary.inputTokens += request.inputTokens;
        summary.outputTokens += request.outputTokens;
        cacheReadTokens += request.cacheReadTokens;
        cacheWriteTokens += request.cacheWriteTokens;
        summary.totalTokens += request.totalTokens;
        summary.costUsd += request.costUsd;
        summary.textChars += request.receivedTextChars;
        summary.thinkingChars += request.receivedThinkingChars;

        if (request.durationMs > 0) {
            durationMs += request.durationMs;
        }
        if (request.ttftMs > 0) {
            ttftTotalMs += request.ttftMs;
            summary.ttftSamples += 1;
        }
        const requestGenerationMs = request.generationMs > 0
            ? request.generationMs
            : request.tokensPerSecond > 0
                ? request.outputTokens / request.tokensPerSecond * 1_000
                : 0;
        if (requestGenerationMs > 0 && request.outputTokens > 0) {
            generationMs += requestGenerationMs;
            summary.speedSamples += 1;
        }
    }

    summary.cacheTokens = cacheReadTokens + cacheWriteTokens;
    summary.responseChars = summary.textChars + summary.thinkingChars;
    summary.successRate = summary.requests > 0
        ? (summary.requests - summary.failed) / summary.requests
        : 0;
    const cacheInput = summary.inputTokens
        + cacheReadTokens
        + cacheWriteTokens;
    summary.cacheHitRate = cacheInput > 0
        ? cacheReadTokens / cacheInput
        : 0;
    summary.averageTtftMs = summary.ttftSamples > 0
        ? ttftTotalMs / summary.ttftSamples
        : 0;
    summary.averageTokensPerSecond = generationMs > 0
        ? summary.outputTokens / (generationMs / 1_000)
        : 0;
    summary.averageCharsPerSecond = durationMs > 0
        ? summary.responseChars / (durationMs / 1_000)
        : 0;
    return summary;
}

function summaryMetricValue(
    summary: UsageSummary,
    metric: UsageMetric
): number {
    switch (metric) {
        case "tokens":
            return summary.totalTokens;
        case "cost":
            return summary.costUsd;
        case "requests":
            return summary.requests;
        case "speed":
            return summary.averageTokensPerSecond;
        case "traffic":
            return summary.responseChars;
    }
}

export function buildUsageBuckets(
    period: UsagePeriod,
    fromMs: number,
    toMs: number,
    locale: string
): UsageBucket[] {
    const span = Math.max(toMs - fromMs, 1);
    const grain = bucketGrain(period, span);
    const formatter = bucketFormatter(grain, locale);
    const buckets: UsageBucket[] = [];
    let cursor = bucketStart(fromMs, grain);
    const end = Math.max(cursor + 1, toMs);

    while (cursor < end) {
        const next = nextBucket(cursor, grain);
        buckets.push({
            startMs: cursor,
            endMs: next,
            label: formatter.format(new Date(cursor)),
            grain
        });
        cursor = next;
    }
    return buckets;
}

export function buildUsageChart(
    requests: readonly UsageRequest[],
    buckets: readonly UsageBucket[],
    metric: UsageMetric
): UsageChartPoint[] {
    const bucketRequests = buckets.map((): UsageRequest[] => []);
    for (const request of requests) {
        const bucketIndex = findBucket(buckets, request.startedAtMs);
        if (bucketIndex !== -1) {
            bucketRequests[bucketIndex]!.push(request);
        }
    }

    const data = buckets.map((bucket, index): UsageChartPoint => {
        const summary = summarizeUsage(bucketRequests[index] ?? []);
        const point: UsageChartPoint = {
            startMs: bucket.startMs,
            endMs: bucket.endMs,
            label: bucket.label,
            grain: bucket.grain,
            value: summaryMetricValue(summary, metric)
        };
        return point;
    });

    return data;
}

export function formatBucketTooltip(
    bucket: UsageBucket,
    locale: string
): string {
    const options: Intl.DateTimeFormatOptions = bucket.grain === "month"
        ? { year: "numeric", month: "long" }
        : bucket.grain === "hour"
            ? {
                month: "numeric",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit"
            }
            : { year: "numeric", month: "numeric", day: "numeric" };
    return new Intl.DateTimeFormat(locale, options).format(
        new Date(bucket.startMs)
    );
}

function bucketGrain(
    period: UsagePeriod,
    spanMs: number
): UsageBucketGrain {
    if (period === "today" || period === "24h") {
        return "hour";
    }
    if (period === "7d" || period === "30d") {
        return "day";
    }
    if (spanMs <= 36 * HOUR_MS) {
        return "hour";
    }
    if (spanMs <= 62 * DAY_MS) {
        return "day";
    }
    if (spanMs <= 400 * DAY_MS) {
        return "week";
    }
    return "month";
}

function bucketFormatter(
    grain: UsageBucketGrain,
    locale: string
): Intl.DateTimeFormat {
    switch (grain) {
        case "hour":
            return new Intl.DateTimeFormat(locale, {
                hour: "2-digit",
                minute: "2-digit"
            });
        case "day":
        case "week":
            return new Intl.DateTimeFormat(locale, {
                month: "numeric",
                day: "numeric"
            });
        case "month":
            return new Intl.DateTimeFormat(locale, {
                year: "2-digit",
                month: "short"
            });
    }
}

function bucketStart(ms: number, grain: UsageBucketGrain): number {
    const date = new Date(ms);
    switch (grain) {
        case "hour":
            return new Date(
                date.getFullYear(),
                date.getMonth(),
                date.getDate(),
                date.getHours()
            ).getTime();
        case "day":
            return startOfLocalDay(ms);
        case "week":
            return startOfLocalDay(ms);
        case "month":
            return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
    }
}

function nextBucket(ms: number, grain: UsageBucketGrain): number {
    const date = new Date(ms);
    switch (grain) {
        case "hour":
            return new Date(
                date.getFullYear(),
                date.getMonth(),
                date.getDate(),
                date.getHours() + 1
            ).getTime();
        case "day":
            return new Date(
                date.getFullYear(),
                date.getMonth(),
                date.getDate() + 1
            ).getTime();
        case "week":
            return new Date(
                date.getFullYear(),
                date.getMonth(),
                date.getDate() + 7
            ).getTime();
        case "month":
            return new Date(
                date.getFullYear(),
                date.getMonth() + 1,
                1
            ).getTime();
    }
}

function startOfLocalDay(ms: number): number {
    const date = new Date(ms);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function findBucket(
    buckets: readonly UsageBucket[],
    startedAtMs: number
): number {
    if (buckets.length === 0) return -1;
    if (
        startedAtMs < buckets[0]!.startMs
        || startedAtMs >= buckets[buckets.length - 1]!.endMs
    ) {
        return -1;
    }
    let low = 0;
    let high = buckets.length - 1;
    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const bucket = buckets[middle]!;
        if (startedAtMs < bucket.startMs) {
            high = middle - 1;
        } else if (startedAtMs >= bucket.endMs) {
            low = middle + 1;
        } else {
            return middle;
        }
    }
    return -1;
}
