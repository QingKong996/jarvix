import { z } from "zod";

export const PROVIDER_PROTOCOLS = [
    "openai-completions",
    "openai-responses",
    "anthropic-messages",
    "google-generative-ai",
    "mistral-conversations",
    "azure-openai-responses",
    "bedrock-converse-stream",
    "google-vertex",
    "openai-codex-responses",
    "pi-messages"
] as const;
export type ProviderProtocol = (typeof PROVIDER_PROTOCOLS)[number];

export const REASONING_LEVELS = [
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max"
] as const;
export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

export const DEFAULT_MODEL_REASONING_LEVELS = ["low", "high", "max"] as const;
export const DEFAULT_REASONING_LEVEL: ReasoningLevel = "max";

const identifier = z.string().trim().min(1);
export const modelDefinitionSchema = z.object({
    id: identifier,
    name: identifier,
    reasoning: z.boolean().default(false),
    reasoningLevels: z.array(z.enum(REASONING_LEVELS)).optional(),
    contextWindow: z.number().int().positive().default(32768),
    maxTokens: z.number().int().positive().default(4096),
    input: z.array(z.enum(["text", "image"])).default(["text"]),
    toolCall: z.boolean().default(false),
    cost: z.object({
        input: z.number().nonnegative().default(0),
        output: z.number().nonnegative().default(0),
        cacheRead: z.number().nonnegative().default(0),
        cacheWrite: z.number().nonnegative().default(0)
    }).default({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
});

const modelDefinitionsSchema = z.array(modelDefinitionSchema).refine(
    (models) => new Set(models.map((model) => model.id)).size === models.length,
    "Duplicate model IDs"
);
const catalogBaseUrlSchema = z.string().trim().min(1)
    .refine((value) => {
        if (value.includes("{")) return true;
        try {
            return /^https?:$/.test(new URL(value).protocol);
        } catch {
            return false;
        }
    }, "Expected an HTTP URL or URL template")
    .transform((value) => value.replace(/\/+$/, ""));

export const providerCatalogEntrySchema = z.object({
    id: identifier,
    name: identifier,
    protocol: z.enum(PROVIDER_PROTOCOLS).optional(),
    baseUrl: catalogBaseUrlSchema.optional(),
    env: z.array(identifier).default([]),
    models: modelDefinitionsSchema
});

export const providerDefinitionSchema = z.object({
    id: identifier,
    name: identifier,
    protocol: z.enum(PROVIDER_PROTOCOLS),
    baseUrl: catalogBaseUrlSchema,
    env: z.array(identifier).default([]),
    models: modelDefinitionsSchema.min(1)
});

export const providerConfigSchema = providerDefinitionSchema.extend({ apiKey: z.string().trim().optional() });
export const modelSelectionSchema = z.object({ provider: identifier, id: identifier });
export const DEFAULT_MODEL = { provider: "deepseek", id: "deepseek-flash" };

export type ReasoningCapabilities = Pick<ModelDefinition, "reasoning" | "reasoningLevels">;
export type ModelDefinition = z.infer<typeof modelDefinitionSchema>;
export type ProviderCatalogEntry = z.infer<typeof providerCatalogEntrySchema>;
export type ProviderDefinition = z.infer<typeof providerDefinitionSchema>;
export type ProviderConfig = z.infer<typeof providerConfigSchema>;
export type ModelSelection = z.infer<typeof modelSelectionSchema>;
export type ModelCatalog = { providers: ProviderCatalogEntry[]; fetchedAt: number; stale: boolean };

export function availableReasoningLevels(model?: ReasoningCapabilities): readonly ReasoningLevel[] {
    if (!model) return DEFAULT_MODEL_REASONING_LEVELS;
    if (!model.reasoning) return [];
    return model.reasoningLevels ?? DEFAULT_MODEL_REASONING_LEVELS;
}

export function resolveReasoningLevel(
    model: ReasoningCapabilities | undefined,
    requested?: ReasoningLevel
): ReasoningLevel | undefined {
    const levels = availableReasoningLevels(model);
    if (levels.length === 0) return undefined;
    if (requested && levels.includes(requested)) return requested;
    return levels.includes(DEFAULT_REASONING_LEVEL)
        ? DEFAULT_REASONING_LEVEL
        : levels[levels.length - 1];
}

export function resolveConfiguredModel(
    providers: readonly ProviderConfig[] | undefined,
    preferred?: ModelSelection
): { selection: ModelSelection; model: ModelDefinition } | undefined {
    if (preferred) {
        const provider = providers?.find((item) => item.id === preferred.provider);
        const model = provider?.models.find((item) => item.id === preferred.id);
        if (provider && model) return { selection: preferred, model };
    }

    for (const provider of providers ?? []) {
        const model = provider.models[0];
        if (model) {
            return { selection: { provider: provider.id, id: model.id }, model };
        }
    }
    return undefined;
}
