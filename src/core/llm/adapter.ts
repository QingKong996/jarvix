import type {
    LlmMessage,
    LlmModelInfo,
    LlmModelRef,
    LlmReasoningLevel,
    LlmStreamEvent,
    LlmToolDefinition
} from "../../protocol/llm.ts";

/** One assistant response request. */
export type LlmRequest = {
    model: LlmModelRef;
    messages: readonly LlmMessage[];
    systemPrompt?: string;
    reasoning?: LlmReasoningLevel;
    temperature?: number;
    maxTokens?: number;
    /** Provider credential. Adapters that resolve credentials themselves may ignore it. */
    apiKey?: string;
    tools?: readonly LlmToolDefinition[];
    signal?: AbortSignal;
    /** Called immediately before one provider HTTP attempt, including internal retries. */
    onProviderRequest?: () => void;
    /** Called for every provider HTTP response, including retry responses. */
    onProviderResponse?: (response: LlmProviderResponse) => void;
};

export type LlmStream = AsyncIterable<LlmStreamEvent>;

export type LlmProviderResponse = {
    status: number;
    retryAfterMs?: number;
};

/** Provider-neutral LLM backend. Other modules depend on this contract, never on a concrete backend. */
export interface LlmAdapter {
    /** Look up one model. Returns undefined when the backend does not expose it. */
    getModel(provider: string, id: string): LlmModelInfo | undefined;
    /** Start one streamed response. Throws when the request cannot be set up at all. */
    stream(request: LlmRequest): LlmStream;
}
