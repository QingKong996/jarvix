import { expect, test } from "vitest";
import type { LlmMessage } from "../../../protocol/llm.ts";
import {
    estimateContextBreakdown,
    estimateContextUsage,
    estimateMessageTokens
} from "./context-usage.ts";

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

test("uses the latest assistant usage and estimates only trailing messages", () => {
    const usage = estimateContextUsage({
        contextWindow: 1_000,
        systemPrompt: "x".repeat(3_500),
        tools: [{
            name: "read_file",
            description: "Read a file",
            parameters: {
                type: "object",
                properties: { path: { type: "string" } }
            }
        }],
        messages: [{
            role: "assistant",
            content: [{ type: "text", text: "reply" }],
            provider: "test",
            model: "test",
            api: "test",
            usage: {
                inputTokens: 90,
                outputTokens: 30,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                totalTokens: 120,
                cost: 0
            },
            stopReason: "stop",
            timestamp: 2
        }, {
            role: "user",
            content: "x".repeat(35),
            timestamp: 3
        }]
    });

    expect(usage.estimatedTokens).toBe(130);
});

test("ignores usage from aborted or failed assistant messages", () => {
    const usage = estimateContextUsage({
        contextWindow: 1_000,
        messages: [{
            role: "assistant",
            content: [{ type: "text", text: "reply" }],
            provider: "test",
            model: "test",
            api: "test",
            usage: {
                inputTokens: 900,
                outputTokens: 100,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                totalTokens: 1_000,
                cost: 0
            },
            stopReason: "error",
            timestamp: 2
        }, {
            role: "user",
            content: "x".repeat(35),
            timestamp: 3
        }]
    });

    expect(usage.estimatedTokens).toBe(12);
});

test("ignores provider usage recorded before the latest compact block", () => {
    const messages: LlmMessage[] = [{
        role: "user",
        content: "x".repeat(3_500),
        timestamp: 1
    }, {
        role: "assistant",
        content: [{ type: "text", text: "reply" }],
        provider: "test",
        model: "test",
        api: "test",
        usage: {
            inputTokens: 190_000,
            outputTokens: 10_000,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 200_000,
            cost: 0
        },
        stopReason: "stop",
        timestamp: 2
    }, {
        role: "user",
        content: "<compact>\nsummary\n</compact>",
        context: "compact",
        timestamp: 3
    }, {
        role: "user",
        content: "y".repeat(350),
        timestamp: 4
    }];
    const fullPromptTokens = messages.reduce(
        (total, message) => total + estimateMessageTokens(message),
        0
    );

    const usage = estimateContextUsage({
        contextWindow: 10_000,
        messages
    });

    expect(usage.estimatedTokens).toBe(fullPromptTokens);
    expect(usage.estimatedTokens).toBeLessThan(2_000);
});

test("uses provider usage recorded after the latest compact block", () => {
    const usage = estimateContextUsage({
        contextWindow: 1_000,
        messages: [{
            role: "user",
            content: "<compact>\nsummary\n</compact>",
            context: "compact",
            timestamp: 1
        }, {
            role: "assistant",
            content: [{ type: "text", text: "reply" }],
            provider: "test",
            model: "test",
            api: "test",
            usage: {
                inputTokens: 90,
                outputTokens: 30,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                totalTokens: 120,
                cost: 0
            },
            stopReason: "stop",
            timestamp: 2
        }, {
            role: "user",
            content: "x".repeat(35),
            timestamp: 3
        }]
    });

    expect(usage.estimatedTokens).toBe(130);
});

test("ignores usage that predates the compact block in history order", () => {
    const messages: LlmMessage[] = [{
        role: "user",
        content: "<compact>\nsummary\n</compact>",
        context: "compact",
        timestamp: 100
    }, {
        role: "assistant",
        content: [{ type: "text", text: "reply" }],
        provider: "test",
        model: "test",
        api: "test",
        usage: {
            inputTokens: 190_000,
            outputTokens: 10_000,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 200_000,
            cost: 0
        },
        stopReason: "stop",
        timestamp: 50
    }, {
        role: "user",
        content: "y".repeat(350),
        timestamp: 60
    }];
    const fullPromptTokens = messages.reduce(
        (total, message) => total + estimateMessageTokens(message),
        0
    );

    const usage = estimateContextUsage({
        contextWindow: 10_000,
        messages
    });

    expect(usage.estimatedTokens).toBe(fullPromptTokens);
    expect(usage.estimatedTokens).toBeLessThan(2_000);
});

test("estimates images with pi-ai's context heuristic", () => {
    const usage = estimateContextUsage({
        contextWindow: 10_000,
        messages: [{
            role: "toolResult",
            toolCallId: "call-image",
            toolName: "view_image",
            content: [{
                type: "image",
                data: "aW1hZ2U=",
                mimeType: "image/png"
            }, {
                type: "text",
                text: "abcd"
            }],
            isError: false,
            timestamp: 1
        }]
    });

    expect(usage.estimatedTokens).toBe(1_373);
});

test("reuses message token estimates across context usage checks", () => {
    let contentReads = 0;
    const message: LlmMessage = {
        role: "toolResult",
        toolCallId: "call",
        toolName: "exec_command",
        get content() {
            contentReads += 1;
            return "result";
        },
        isError: false,
        timestamp: 1
    };

    estimateContextUsage({ contextWindow: 1_000, messages: [message] });
    estimateContextUsage({ contextWindow: 1_000, messages: [message] });

    expect(contentReads).toBe(1);
});

test("does not estimate persisted tool details as model context", () => {
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

    expect(detailReads).toBe(0);
});

test("breaks down the prompt into the same total as context usage", () => {
    const input = {
        systemPrompt: "System instructions",
        tools: [{
            name: "read_file",
            description: "Read a file",
            parameters: {
                type: "object",
                properties: { path: { type: "string" } }
            }
        }],
        messages: [{
            role: "system",
            content: "<environment_context>fixture</environment_context>",
            context: "environment",
            timestamp: 1
        }, {
            role: "system",
            content: "Available skills",
            context: "injected",
            timestamp: 2
        }, {
            role: "user",
            content: "Inspect the repository.",
            timestamp: 3
        }, {
            role: "assistant",
            content: [{
                type: "text",
                text: "I will inspect it."
            }, {
                type: "toolCall",
                id: "call-1",
                name: "read_file",
                arguments: { path: "README.md" }
            }],
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
            timestamp: 4
        }, {
            role: "toolResult",
            toolCallId: "call-1",
            toolName: "read_file",
            content: "file contents",
            isError: false,
            timestamp: 5
        }] as LlmMessage[]
    };

    const usage = estimateContextUsage({
        contextWindow: 10_000,
        ...input
    });
    const breakdown = estimateContextBreakdown(input);

    expect(breakdown.systemPrompt).toBeGreaterThan(0);
    expect(breakdown.tools).toBeGreaterThan(0);
    expect(breakdown.injected).toBeGreaterThan(0);
    expect(breakdown.user).toBeGreaterThan(0);
    expect(breakdown.assistant).toBeGreaterThan(0);
    expect(breakdown.tool).toBeGreaterThan(0);
    expect(Object.values(breakdown).reduce((sum, tokens) => sum + tokens, 0))
        .toBe(usage.estimatedTokens);
});
