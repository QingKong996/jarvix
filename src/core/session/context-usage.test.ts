import { expect, test } from "vitest";
import { estimateContextUsage } from "./context-usage.ts";

test("estimates the full prompt including history and tool definitions", () => {
    const empty = estimateContextUsage({
        contextWindow: 128_000,
        messages: []
    });
    const populated = estimateContextUsage({
        contextWindow: 128_000,
        systemPrompt: "System instructions",
        messages: [
            {
                role: "user",
                content: "Explain this repository.",
                timestamp: 1
            }
        ],
        tools: [{
            name: "read_file",
            description: "Read a file",
            parameters: {
                type: "object",
                properties: { path: { type: "string" } }
            }
        }]
    });

    expect(populated.estimatedTokens).toBeGreaterThan(empty.estimatedTokens);
    expect(populated.contextWindow).toBe(128_000);
});

test("counts non-ASCII text more heavily than ASCII text", () => {
    const estimate = (content: string) => estimateContextUsage({
        contextWindow: 1_000,
        messages: [{ role: "user", content, timestamp: 1 }]
    }).estimatedTokens;

    expect(estimate("上".repeat(100))).toBeGreaterThan(estimate("a".repeat(100)));
});
