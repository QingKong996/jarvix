import { expect, test } from "vitest";
import type { LlmMessage } from "../../llm/types.ts";
import { estimateContextUsage, fitMessagesToContext } from "./context-usage.ts";

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

test("keeps the newest user turn and drops older complete tool turns", () => {
    const oldToolCall: LlmMessage = {
        role: "assistant",
        content: [
            { type: "text", text: "a".repeat(3_000) },
            {
                type: "toolCall",
                id: "old-call",
                name: "exec_command",
                arguments: { command: "old" }
            }
        ],
        provider: "test",
        model: "test",
        api: "test",
        usage: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 0,
            cost: 0
        },
        stopReason: "toolUse",
        timestamp: 2
    };
    const messages: LlmMessage[] = [
        { role: "user", content: "old question", timestamp: 1 },
        oldToolCall,
        {
            role: "toolResult",
            toolCallId: "old-call",
            toolName: "exec_command",
            content: "x".repeat(1_000),
            isError: false,
            timestamp: 3
        },
        { role: "user", content: "latest question", timestamp: 4 }
    ];

    const fitted = fitMessagesToContext({
        contextWindow: 800,
        maxOutputTokens: 100,
        messages
    });

    expect(fitted.fits).toBe(true);
    expect(fitted.omittedMessages).toBeGreaterThan(0);
    expect(fitted.messages[0]).toMatchObject({
        role: "user",
        context: "system-reminder",
        content: expect.stringContaining("omitted")
    });
    expect(fitted.messages.at(-1)).toMatchObject({
        role: "user",
        content: "latest question"
    });
    expect(fitted.messages.some((message) => message.role === "toolResult")).toBe(false);
    expect(fitted.messages.some((message) => (
        message.role === "assistant"
        && message.content.some((block) => block.type === "toolCall")
    ))).toBe(false);
    expect(fitted.estimatedTokens).toBeLessThanOrEqual(700);
});

test("reports when even the newest turn exceeds the input budget", () => {
    const fitted = fitMessagesToContext({
        contextWindow: 100,
        maxOutputTokens: 10,
        messages: [
            { role: "user", content: "latest question", timestamp: 1 },
            { role: "assistant", content: [{ type: "text", text: "a".repeat(500) }], provider: "test", model: "test", api: "test", usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, cost: 0 }, stopReason: "stop", timestamp: 2 }
        ]
    });

    expect(fitted.fits).toBe(false);
    expect(fitted.messages.at(-1)).toMatchObject({
        role: "assistant",
        content: [{ type: "text", text: "a".repeat(500) }]
    });
});

test("retains a required reminder without counting or duplicating it as omitted history", () => {
    const reminder: LlmMessage = {
        role: "user",
        content: "<system-reminder>\n<environment_context>\nworkspace-b\n</environment_context>\n</system-reminder>",
        context: "system-reminder",
        timestamp: 2
    };
    const messages: LlmMessage[] = [
        { role: "user", content: `old ${"a".repeat(1_000)}`, timestamp: 1 },
        reminder,
        { role: "assistant", content: [{ type: "text", text: "old response" }], provider: "test", model: "test", api: "test", usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, cost: 0 }, stopReason: "stop", timestamp: 3 },
        { role: "user", content: "latest question", timestamp: 4 }
    ];

    const fitted = fitMessagesToContext({
        contextWindow: 250,
        maxOutputTokens: 20,
        messages,
        requiredMessages: [reminder]
    });

    expect(fitted.fits).toBe(true);
    expect(fitted.messages.filter((message) => message === reminder)).toHaveLength(1);
    expect(fitted.omittedMessages).toBe(2);
    expect(fitted.messages.at(-1)).toMatchObject({
        role: "user",
        content: "latest question"
    });
});

test("estimates each history message only once while trimming an oversized prompt", () => {
    let detailReads = 0;
    const details = {
        get payload(): string {
            detailReads += 1;
            return "x";
        }
    };
    const messages: LlmMessage[] = [...Array.from({ length: 80 }, (_, index): LlmMessage => ({
        role: "user",
        content: `question ${index}`,
        timestamp: index + 1
    })), {
        role: "toolResult",
        toolCallId: "old-call",
        toolName: "exec_command",
        content: "old result",
        details,
        isError: false,
        timestamp: 81
    }, {
        role: "user",
        content: "x".repeat(10_000),
        timestamp: 82
    }];

    const fitted = fitMessagesToContext({
        contextWindow: 100,
        messages
    });

    expect(fitted.fits).toBe(false);
    expect(detailReads).toBe(1);
});
