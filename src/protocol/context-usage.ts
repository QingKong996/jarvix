/** Prompt usage reported by the provider through the latest response, plus trailing estimates. */
export type JarvixContextUsage = {
    estimatedTokens: number;
    contextWindow: number;
};
