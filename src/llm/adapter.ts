import type { LlmMessage, LlmModelInfo, LlmModelRef, LlmReasoningLevel, LlmStreamEvent } from "./types.ts";

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
    signal?: AbortSignal;
};

export type LlmStream = AsyncIterable<LlmStreamEvent>;

/** Provider-neutral LLM backend. Other modules depend on this contract, never on a concrete backend. */
export interface LlmAdapter {
    /** Look up one model. Returns undefined when the backend does not expose it. */
    getModel(provider: string, id: string): LlmModelInfo | undefined;
    /** Start one streamed response. Throws when the request cannot be set up at all. */
    stream(request: LlmRequest): LlmStream;
}
