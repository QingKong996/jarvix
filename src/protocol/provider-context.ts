import type { LlmMessage } from "./llm.ts";

export type JarvixProviderContext = {
    systemPrompt: string;
    messages: readonly LlmMessage[];
};
