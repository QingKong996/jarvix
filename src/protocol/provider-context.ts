import type { LlmMessage } from "./llm.ts";

export type JarvixContextUsagePoint = {
    step: number;
    atMs: number;
    estimatedTokens: number;
    current?: true;
};

export type JarvixContextBreakdown = {
    systemPrompt: number;
    tools: number;
    user: number;
    injected: number;
    skills: number;
    assistant: number;
    tool: number;
};

export type JarvixProviderContext = {
    systemPrompt: string;
    messages: readonly LlmMessage[];
    breakdown?: JarvixContextBreakdown;
    usageHistory?: readonly JarvixContextUsagePoint[];
};
