import { expect, test } from "vitest";
import type { ModelCost } from "../../protocol/providers.ts";
import {
    applicableModelCostRate,
    calculateUsageCost,
    hasModelPrices
} from "./usage-pricing.ts";

const cost: ModelCost = {
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
};

test("prices regular and cached tokens from the applicable tier", () => {
    const regular = {
        inputTokens: 100_000,
        outputTokens: 10_000,
        cacheReadTokens: 50_000,
        cacheWriteTokens: 5_000
    };
    expect(applicableModelCostRate(cost, regular)).toBe(cost);
    expect(calculateUsageCost(cost, regular)).toBeCloseTo(0.21125, 8);

    const longContext = {
        ...regular,
        inputTokens: 150_000,
        cacheReadTokens: 60_000
    };
    expect(applicableModelCostRate(cost, longContext).input).toBe(2);
    expect(calculateUsageCost(cost, longContext)).toBeCloseTo(0.5245, 8);
});

test("distinguishes configured prices from missing metadata", () => {
    expect(hasModelPrices(cost)).toBe(true);
    expect(hasModelPrices({
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0
    })).toBe(false);
});
