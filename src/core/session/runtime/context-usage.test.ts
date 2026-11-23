import { expect, test } from "vitest";
import type { LlmMessage } from "../../../protocol/llm.ts";
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

test("reuses message token estimates across context usage checks", () => {
    let detailReads = 0;
    const details = {
        get payload(): string {
            detailReads += 1;
            return "x";
        }
    };
    const message: LlmMessage = {
        role: "toolResult",
        toolCallId: "call",
        toolName: "exec_command",
        content: "result",
        details,
        isError: false,
        timestamp: 1
    };

    estimateContextUsage({ contextWindow: 1_000, messages: [message] });
    estimateContextUsage({ contextWindow: 1_000, messages: [message] });

    expect(detailReads).toBe(1);
});
