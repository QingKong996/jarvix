import type { LlmMessage } from "../llm/types.ts";

export type JarvixProviderContext = {
    systemPrompt: string;
    messages: readonly LlmMessage[];
};
