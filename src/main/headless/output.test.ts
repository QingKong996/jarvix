import { expect, test } from "vitest";
import type { LlmAssistantMessage, LlmMessage } from "../../protocol/llm.ts";
import { finalAssistantText } from "./output.ts";

test("returns only the final assistant text", () => {
    const messages: LlmMessage[] = [
        assistant("Earlier response"),
        {
            role: "user",
            content: "Follow up",
            timestamp: 2
        },
        assistant("Final response", "Second block")
    ];

    expect(finalAssistantText(messages)).toBe("Final response\nSecond block");
});

test("returns an empty string when no assistant message exists", () => {
    expect(finalAssistantText([{
        role: "user",
        content: "Hello",
        timestamp: 1
    }])).toBe("");
});

function assistant(...texts: string[]): LlmAssistantMessage {
    return {
        role: "assistant",
        content: texts.map((text) => ({ type: "text", text })),
        provider: "test",
        model: "test-model",
        api: "openai-completions",
        usage: {
            inputTokens: 1,
            outputTokens: 1,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 2,
            cost: 0
        },
        stopReason: "stop",
        timestamp: 1
    };
}
