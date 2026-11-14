import { createModels, createProvider, envApiKeyAuth, type Models } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { mistralConversationsApi } from "@earendil-works/pi-ai/api/mistral-conversations.lazy";
import { azureOpenAIResponsesApi } from "@earendil-works/pi-ai/api/azure-openai-responses.lazy";
import { bedrockConverseStreamApi } from "@earendil-works/pi-ai/api/bedrock-converse-stream.lazy";
import { googleVertexApi } from "@earendil-works/pi-ai/api/google-vertex.lazy";
import { openAICodexResponsesApi } from "@earendil-works/pi-ai/api/openai-codex-responses.lazy";
import { piMessagesApi } from "@earendil-works/pi-ai/api/pi-messages.lazy";
import type { ProviderConfig, ProviderProtocol } from "../protocol/providers.ts";

const apis = {
    "openai-completions": openAICompletionsApi,
    "openai-responses": openAIResponsesApi,
    "anthropic-messages": anthropicMessagesApi,
    "google-generative-ai": googleGenerativeAIApi,
    "mistral-conversations": mistralConversationsApi,
    "azure-openai-responses": azureOpenAIResponsesApi,
    "bedrock-converse-stream": bedrockConverseStreamApi,
    "google-vertex": googleVertexApi,
    "openai-codex-responses": openAICodexResponsesApi,
    "pi-messages": piMessagesApi
} satisfies Record<ProviderProtocol, () => unknown>;

export function configuredModels(providers: readonly ProviderConfig[]): Models {
    const models = createModels();
    for (const provider of providers) {
        models.setProvider(createProvider({
            id: provider.id,
            name: provider.name,
            baseUrl: provider.baseUrl,
            auth: { apiKey: envApiKeyAuth(`${provider.name} API key`, provider.env) },
            api: apis[provider.protocol](),
            models: provider.models.map((model) => ({
                ...model,
                provider: provider.id,
                api: provider.protocol,
                baseUrl: provider.baseUrl
            }))
        }));
    }
    return models;
}
