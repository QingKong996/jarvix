import type { LlmAdapter } from "./adapter.ts";
import { createPiAdapter } from "./pi.ts";

/** Creates the LLM adapter used by the app. pi-ai is the only backend for now. */
export function createLlm(): LlmAdapter {
    return createPiAdapter();
}

export type { LlmAdapter, LlmRequest, LlmStream } from "./adapter.ts";
export type {
    LlmAssistantMessage,
    LlmContentBlock,
    LlmMessage,
    LlmModelInfo,
    LlmModelRef,
    LlmReasoningLevel,
    LlmStopReason,
    LlmStreamEvent,
    LlmTextBlock,
    LlmThinkingBlock,
    LlmToolCallBlock,
    LlmUsage,
    LlmUserMessage
} from "./types.ts";
