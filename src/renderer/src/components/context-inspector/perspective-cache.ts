import type { JarvixCacheUsagePoint } from "../../../../protocol/provider-context.ts";

const MAX_CACHE_POINTS = 120;
const MIN_ANOMALY_POINTS = 4;
const MIN_ANOMALY_DEVIATION = 0.15;
const MAD_NORMALIZATION = 1.4826;
const MAD_MULTIPLIER = 3;

export type PerspectiveCacheAnomaly = "low" | "high";

export type PerspectiveCachePoint = JarvixCacheUsagePoint & {
    hitRate: number;
    anomaly: PerspectiveCacheAnomaly | null;
};

export type PerspectiveCacheAnomalyPoint = PerspectiveCachePoint & {
    anomaly: PerspectiveCacheAnomaly;
};

export type PerspectiveCacheAnalysis = {
    points: PerspectiveCachePoint[];
    latestHitRate: number;
    averageHitRate: number;
    anomalies: PerspectiveCacheAnomalyPoint[];
};

export function perspectiveCacheFor(
    history: readonly JarvixCacheUsagePoint[]
): PerspectiveCacheAnalysis | null {
    const points = history
        .flatMap(normalizeCachePoint)
        .sort((left, right) => (
            left.step - right.step || left.atMs - right.atMs
        ))
        .slice(-MAX_CACHE_POINTS);
    if (points.length === 0) {
        return null;
    }

    const medianHitRate = median(points.map((point) => point.hitRate));
    const medianDeviation = median(points.map((point) => (
        Math.abs(point.hitRate - medianHitRate)
    )));
    const threshold = Math.max(
        MIN_ANOMALY_DEVIATION,
        medianDeviation * MAD_NORMALIZATION * MAD_MULTIPLIER
    );
    const detectAnomalies = points.length >= MIN_ANOMALY_POINTS;
    const annotated = points.map((point): PerspectiveCachePoint => {
        const deviation = point.hitRate - medianHitRate;
        const anomaly = detectAnomalies && Math.abs(deviation) >= threshold
            ? deviation < 0
                ? "low"
                : "high"
            : null;
        return { ...point, anomaly };
    });
    let cacheReadTokens = 0;
    let cacheInputTokens = 0;
    for (const point of annotated) {
        cacheReadTokens += point.cacheReadTokens;
        cacheInputTokens += point.inputTokens
            + point.cacheReadTokens
            + point.cacheWriteTokens;
    }

    return {
        points: annotated,
        latestHitRate: annotated.at(-1)!.hitRate,
        averageHitRate: cacheInputTokens > 0
            ? cacheReadTokens / cacheInputTokens
            : 0,
        anomalies: annotated.filter(isAnomalyPoint)
    };
}

function normalizeCachePoint(
    point: JarvixCacheUsagePoint
): PerspectiveCachePoint[] {
    if (
        !Number.isFinite(point.step)
        || point.step <= 0
        || !Number.isFinite(point.atMs)
    ) {
        return [];
    }
    const inputTokens = tokenCount(point.inputTokens);
    const cacheReadTokens = tokenCount(point.cacheReadTokens);
    const cacheWriteTokens = tokenCount(point.cacheWriteTokens);
    const cacheInputTokens = inputTokens + cacheReadTokens + cacheWriteTokens;
    if (cacheInputTokens <= 0) {
        return [];
    }
    return [{
        step: Math.round(point.step),
        atMs: point.atMs,
        inputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        hitRate: Math.min(1, cacheReadTokens / cacheInputTokens),
        anomaly: null
    }];
}

function tokenCount(value: number): number {
    return Number.isFinite(value) && value > 0
        ? Math.round(value)
        : 0;
}

function median(values: readonly number[]): number {
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) {
        return sorted[middle]!;
    }
    return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function isAnomalyPoint(
    point: PerspectiveCachePoint
): point is PerspectiveCacheAnomalyPoint {
    return point.anomaly !== null;
}
