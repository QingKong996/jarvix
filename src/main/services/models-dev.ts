import { z } from "zod";
import {
    REASONING_LEVELS,
    providerCatalogEntrySchema,
    type ModelCost,
    type ModelCostRate,
    type ModelCostTier,
    type ProviderCatalogEntry,
    type ProviderProtocol,
    type ReasoningLevel
} from "../../protocol/providers.ts";

const record = z.record(z.string(), z.unknown());
const upstreamCostRate = z.object({
    input: z.number().nonnegative().optional(),
    output: z.number().nonnegative().optional(),
    cache_read: z.number().nonnegative().optional(),
    cache_write: z.number().nonnegative().optional()
});
const upstreamCostTier = upstreamCostRate.extend({
    tier: z.object({
        type: z.string(),
        size: z.number().positive()
    })
});
const upstreamProvider = z.object({
    id: z.string(), name: z.string(), npm: z.string(), api: z.string().optional(),
    env: z.array(z.string()).default([]), models: record
});
const upstreamModel = z.object({
    id: z.string(), name: z.string(), reasoning: z.boolean().default(false),
    reasoning_options: z.unknown().optional(),
    tool_call: z.boolean().default(false),
    modalities: z.object({ input: z.array(z.string()), output: z.array(z.string()) }).optional(),
    limit: z.object({ context: z.number().positive(), output: z.number().positive() }),
    cost: upstreamCostRate.extend({
        tiers: z.array(upstreamCostTier).optional(),
        context_over_200k: upstreamCostRate.optional()
    }).optional(),
    status: z.string().optional()
});
const upstreamReasoningOption = z.object({
    type: z.string(),
    values: z.array(z.string()).optional()
});
const reasoningLevelSet: ReadonlySet<string> = new Set(REASONING_LEVELS);

const protocols: Record<string, ProviderProtocol> = {
    "@ai-sdk/openai-compatible": "openai-completions",
    "@ai-sdk/openai": "openai-responses",
    "@ai-sdk/anthropic": "anthropic-messages",
    "@ai-sdk/google": "google-generative-ai",
    "@ai-sdk/amazon-bedrock": "bedrock-converse-stream",
    "@ai-sdk/azure": "azure-openai-responses",
    "@ai-sdk/cerebras": "openai-completions",
    "@ai-sdk/cohere": "openai-completions",
    "@ai-sdk/deepinfra": "openai-completions",
    "@ai-sdk/gateway": "openai-completions",
    "@ai-sdk/google-vertex": "google-vertex",
    "@ai-sdk/groq": "openai-completions",
    "@ai-sdk/mistral": "mistral-conversations",
    "@ai-sdk/perplexity": "openai-completions",
    "@ai-sdk/togetherai": "openai-completions",
    "@ai-sdk/xai": "openai-responses",
    "@aihubmix/ai-sdk-provider": "openai-completions",
    "@openrouter/ai-sdk-provider": "openai-completions",
    "merge-gateway-ai-sdk-provider": "openai-completions",
    "venice-ai-sdk-provider": "openai-completions"
};
const endpoints: Record<string, string> = {
    openai: "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com",
    google: "https://generativelanguage.googleapis.com/v1beta",
    xai: "https://api.x.ai/v1",
    togetherai: "https://api.together.ai/v1",
    mistral: "https://api.mistral.ai",
    perplexity: "https://api.perplexity.ai",
    groq: "https://api.groq.com/openai/v1",
    cerebras: "https://api.cerebras.ai/v1",
    cohere: "https://api.cohere.ai/compatibility/v1",
    deepinfra: "https://api.deepinfra.com/v1/openai",
    vercel: "https://ai-gateway.vercel.sh/v1",
    aihubmix: "https://aihubmix.com/v1",
    venice: "https://api.venice.ai/api/v1",
    azure: "https://{resource}.openai.azure.com/openai/v1",
    "azure-cognitive-services": "https://{resource}.cognitiveservices.azure.com/openai/v1",
    "amazon-bedrock": "https://bedrock-runtime.us-east-1.amazonaws.com",
    "google-vertex": "https://{location}-aiplatform.googleapis.com"
};

/** Only catalog data crosses this boundary; npm names identify protocols and are never imported. */
export function parseModelsDevCatalog(value: unknown): ProviderCatalogEntry[] {
    const providers: ProviderCatalogEntry[] = [];
    for (const entry of Object.values(record.parse(value))) {
        const parsed = upstreamProvider.safeParse(entry);
        if (!parsed.success) continue;
        const provider = parsed.data;
        const protocol = protocols[provider.npm];
        const baseUrl = provider.api ?? endpoints[provider.id];
        const models = Object.values(provider.models).flatMap((entry) => {
            const parsed = upstreamModel.safeParse(entry);
            if (!parsed.success) return [];
            const model = parsed.data;
            if (model.status === "deprecated" || (model.modalities && !model.modalities.output.includes("text"))) return [];
            return [{
                id: model.id, name: model.name, reasoning: model.reasoning,
                reasoningLevels: normalizeReasoningLevels(model.reasoning_options), toolCall: model.tool_call,
                contextWindow: model.limit.context, maxTokens: model.limit.output,
                input: (model.modalities?.input ?? ["text"]).filter((input) => input === "text" || input === "image"),
                cost: normalizeCost(model.cost)
            }];
        });
        const normalized = providerCatalogEntrySchema.safeParse({ ...provider, protocol, baseUrl, models });
        if (normalized.success) providers.push(normalized.data);
    }
    if (providers.length === 0) throw new Error("models.dev returned no providers");
    return providers.sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeCost(value: z.infer<typeof upstreamCostRate> & {
    tiers?: z.infer<typeof upstreamCostTier>[];
    context_over_200k?: z.infer<typeof upstreamCostRate>;
} | undefined): ModelCost {
    const base: ModelCostRate = {
        input: value?.input ?? 0,
        output: value?.output ?? 0,
        cacheRead: value?.cache_read ?? 0,
        cacheWrite: value?.cache_write ?? 0
    };
    const tiers = new Map<number, ModelCostTier>();
    for (const tier of value?.tiers ?? []) {
        if (tier.tier.type !== "context") continue;
        tiers.set(tier.tier.size, {
            input: tier.input ?? base.input,
            output: tier.output ?? base.output,
            cacheRead: tier.cache_read ?? base.cacheRead,
            cacheWrite: tier.cache_write ?? base.cacheWrite,
            inputTokensAbove: tier.tier.size
        });
    }
    if (value?.context_over_200k && !tiers.has(200_000)) {
        const tier = value.context_over_200k;
        tiers.set(200_000, {
            input: tier.input ?? base.input,
            output: tier.output ?? base.output,
            cacheRead: tier.cache_read ?? base.cacheRead,
            cacheWrite: tier.cache_write ?? base.cacheWrite,
            inputTokensAbove: 200_000
        });
    }
    return {
        ...base,
        ...(tiers.size > 0
            ? {
                tiers: [...tiers.values()].sort(
                    (left, right) => left.inputTokensAbove - right.inputTokensAbove
                )
            }
            : {})
    };
}

function normalizeReasoningLevels(value: unknown): ReasoningLevel[] {
    const options = Array.isArray(value) ? value : value === undefined ? [] : [value];
    const effortValues = options.flatMap((option) => {
        const parsed = upstreamReasoningOption.safeParse(option);
        return parsed.success && parsed.data.type === "effort" ? parsed.data.values ?? [] : [];
    });
    const levels = new Set(effortValues.filter((level): level is ReasoningLevel => reasoningLevelSet.has(level)));
    return REASONING_LEVELS.filter((level) => levels.has(level));
}
