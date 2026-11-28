import { expect, test } from "vitest";
import type { JarvixCacheUsagePoint } from "../../../../protocol/provider-context.ts";
import { perspectiveCacheFor } from "./perspective-cache.ts";

test("orders cache samples and derives hit rates from reported tokens", () => {
    const analysis = perspectiveCacheFor([
        {
            step: 2,
            atMs: 2_000,
            inputTokens: 750,
            cacheReadTokens: 250,
            cacheWriteTokens: 2_000
        },
        { ...cachePoint(9, 1, 1_000), atMs: Number.NaN },
        cachePoint(1, 0.8, 1_000)
    ]);

    expect(analysis?.points).toEqual([
        {
            step: 1,
            atMs: 1_000,
            inputTokens: 200,
            cacheReadTokens: 800,
            cacheWriteTokens: 0,
            hitRate: 0.8,
            anomaly: null
        },
        {
            step: 2,
            atMs: 2_000,
            inputTokens: 750,
            cacheReadTokens: 250,
            cacheWriteTokens: 2_000,
            hitRate: 0.08333333333333333,
            anomaly: null
        }
    ]);
    expect(analysis?.latestHitRate).toBeCloseTo(1 / 12, 8);
    expect(analysis?.averageHitRate).toBeCloseTo(
        1_050 / 4_000,
        8
    );
});

test("marks unusually low and high cache hit rates", () => {
    const analysis = perspectiveCacheFor([
        cachePoint(1, 0.8, 1_000),
        cachePoint(2, 0.82, 1_000),
        cachePoint(3, 0.81, 1_000),
        cachePoint(4, 0.79, 1_000),
        cachePoint(5, 0.2, 1_000),
        cachePoint(6, 0.99, 1_000)
    ]);

    expect(analysis?.anomalies.map((point) => [
        point.step,
        point.anomaly
    ])).toEqual([
        [5, "low"],
        [6, "high"]
    ]);
});

test("does not flag anomalies without enough samples", () => {
    const analysis = perspectiveCacheFor([
        cachePoint(1, 0.8, 1_000),
        cachePoint(2, 0.82, 1_000),
        cachePoint(3, 0.1, 1_000)
    ]);

    expect(analysis?.anomalies).toEqual([]);
});

function cachePoint(
    step: number,
    hitRate: number,
    totalTokens: number
): JarvixCacheUsagePoint {
    const cacheReadTokens = Math.round(totalTokens * hitRate);
    return {
        step,
        atMs: step * 1_000,
        inputTokens: totalTokens - cacheReadTokens,
        cacheReadTokens,
        cacheWriteTokens: 0
    };
}
