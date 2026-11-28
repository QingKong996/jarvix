import type { ModelCost, ModelCostRate } from "../../protocol/providers.ts";

type UsageTokenCounts = {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
};

export function hasModelPrices(cost: ModelCost | undefined): cost is ModelCost {
    if (!cost) return false;
    return cost.input > 0
        || cost.output > 0
        || cost.cacheRead > 0
        || cost.cacheWrite > 0
        || (cost.tiers?.some((tier) => (
            tier.input > 0
            || tier.output > 0
            || tier.cacheRead > 0
            || tier.cacheWrite > 0
        )) ?? false);
}

export function applicableModelCostRate(
    cost: ModelCost,
    usage: UsageTokenCounts
): ModelCostRate {
    const inputTokens = usage.inputTokens
        + usage.cacheReadTokens
        + usage.cacheWriteTokens;
    let selected: ModelCostRate = cost;
    let threshold = -1;
    for (const tier of cost.tiers ?? []) {
        if (inputTokens > tier.inputTokensAbove && tier.inputTokensAbove > threshold) {
            selected = tier;
            threshold = tier.inputTokensAbove;
        }
    }
    return selected;
}

export function calculateUsageCost(
    cost: ModelCost,
    usage: UsageTokenCounts
): number {
    const rate = applicableModelCostRate(cost, usage);
    return (
        rate.input * usage.inputTokens
        + rate.output * usage.outputTokens
        + rate.cacheRead * usage.cacheReadTokens
        + rate.cacheWrite * usage.cacheWriteTokens
    ) / 1_000_000;
}
