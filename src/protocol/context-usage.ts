/** Approximate prompt token usage for the selected model's context window. */
export type JarvixContextUsage = {
    estimatedTokens: number;
    contextWindow: number;
    /** Number of older messages omitted from the next provider request. */
    omittedMessages?: number;
};
