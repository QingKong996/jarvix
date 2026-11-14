import { expect, test } from "vitest";
import { parseModelsDevCatalog } from "./catalog.ts";

const model = {
    id: "chat", name: "Chat", reasoning: true, tool_call: true,
    reasoning_options: [
        { type: "toggle" },
        { type: "effort", values: ["none", "low", "high", "max"] },
        { type: "budget_tokens", min: 1024 }
    ],
    modalities: { input: ["text", "image", "audio"], output: ["text"] },
    limit: { context: 128000, output: 8192 }, cost: { input: 1, output: 3, cache_read: 0.1 }
};

export const catalogFixture = {
    example: { id: "example", name: "Example", npm: "@ai-sdk/openai-compatible", api: "https://example.com/v1/",
        env: ["EXAMPLE_KEY"], models: { chat: model, broken: {}, deprecated: { ...model, id: "old", status: "deprecated" } } },
    openai: { id: "openai", name: "OpenAI", npm: "@ai-sdk/openai", models: { chat: model } },
    xai: { id: "xai", name: "xAI", npm: "@ai-sdk/xai", models: { chat: model } },
    mistral: { id: "mistral", name: "Mistral", npm: "@ai-sdk/mistral", models: { chat: model } },
    bedrock: { id: "amazon-bedrock", name: "Amazon Bedrock", npm: "@ai-sdk/amazon-bedrock", models: { chat: model } },
    vertex: { id: "google-vertex", name: "Vertex", npm: "@ai-sdk/google-vertex", models: { chat: model } },
    openrouter: { id: "openrouter", name: "OpenRouter", npm: "@openrouter/ai-sdk-provider",
        api: "https://openrouter.ai/api/v1", models: { chat: model } },
    unsupported: { id: "unsupported", name: "Unsupported", npm: "gitlab-ai-provider", models: { chat: model } }
};

test("normalizes catalog defaults across pi-ai protocols", () => {
    const providers = parseModelsDevCatalog({ ...catalogFixture, broken: null });
    expect(providers).toHaveLength(8);
    expect(providers.find((provider) => provider.id === "example")).toMatchObject({
        id: "example", protocol: "openai-completions", baseUrl: "https://example.com/v1",
        env: ["EXAMPLE_KEY"], models: [{ id: "chat", contextWindow: 128000, maxTokens: 8192,
            reasoning: true, reasoningLevels: ["none", "low", "high", "max"], toolCall: true, input: ["text", "image"],
            cost: { input: 1, output: 3, cacheRead: 0.1, cacheWrite: 0 } }]
    });
    expect(providers.find((provider) => provider.id === "openai")?.baseUrl).toBe("https://api.openai.com/v1");
    expect(providers.find((provider) => provider.id === "openrouter")).toMatchObject({
        protocol: "openai-completions", baseUrl: "https://openrouter.ai/api/v1"
    });
    expect(providers.find((provider) => provider.id === "xai")).toMatchObject({
        protocol: "openai-responses", baseUrl: "https://api.x.ai/v1"
    });
    expect(providers.find((provider) => provider.id === "mistral")).toMatchObject({
        protocol: "mistral-conversations", baseUrl: "https://api.mistral.ai"
    });
    expect(providers.find((provider) => provider.id === "amazon-bedrock")).toMatchObject({
        protocol: "bedrock-converse-stream", baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com"
    });
    expect(providers.find((provider) => provider.id === "google-vertex")).toMatchObject({
        protocol: "google-vertex", baseUrl: "https://{location}-aiplatform.googleapis.com"
    });
    expect(providers.find((provider) => provider.id === "unsupported")).toMatchObject({
        protocol: undefined, baseUrl: undefined
    });
});

test("rejects an unusable catalog instead of replacing a successful cache", () => {
    expect(() => parseModelsDevCatalog({ example: { ...catalogFixture.example, api: "file:///tmp" } })).toThrow();
    expect(() => parseModelsDevCatalog([])).toThrow();
});
