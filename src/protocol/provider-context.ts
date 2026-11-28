import type { LlmMessage } from "./llm.ts";

export type JarvixContextUsagePoint = {
    step: number;
    atMs: number;
    estimatedTokens: number;
    current?: true;
};

export type JarvixCacheUsagePoint = {
    step: number;
    atMs: number;
    inputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
};

export type JarvixContextBreakdown = {
    systemPrompt: number;
    tools: number;
    user: number;
    injected: number;
    assistant: number;
    tool: number;
};

export type JarvixProviderContext = {
    systemPrompt: string;
    messages: readonly LlmMessage[];
    breakdown?: JarvixContextBreakdown;
    usageHistory?: readonly JarvixContextUsagePoint[];
    cacheHistory?: readonly JarvixCacheUsagePoint[];
};
