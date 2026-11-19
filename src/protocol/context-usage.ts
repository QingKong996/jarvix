/** Approximate prompt token usage for the selected model's context window. */
export type JarvixContextUsage = {
    estimatedTokens: number;
    contextWindow: number;
};
