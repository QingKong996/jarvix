import { expect, test } from "vitest";
import type { LlmMessage } from "../../../../protocol/llm.ts";
import { perspectiveTimingFor } from "./perspective-timing.ts";

test("builds proportional perspective timing from assistant and tool messages", () => {
    const messages: LlmMessage[] = [
        {
            role: "assistant",
            content: [{ type: "text", text: "done" }],
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
            timestamp: 2_000,
            timing: {
                startedAt: 1_000,
                endedAt: 1_600,
                durationMs: 600,
                spans: [
                    { kind: "thinking", startedAt: 1_000, durationMs: 400 },
                    { kind: "output", startedAt: 1_400, durationMs: 200 }
                ]
            }
        },
        {
            role: "toolResult",
            toolCallId: "call-1",
            toolName: "exec_command",
            content: "ok",
            isError: false,
            timestamp: 2_200,
            timing: {
                startedAt: 1_600,
                endedAt: 2_200,
                durationMs: 600
            }
        }
    ];

    const timing = perspectiveTimingFor(messages);

    expect(timing.totalMs).toBe(1_200);
    expect(timing.startedAt).toBe(1_000);
    expect(timing.endedAt).toBe(2_200);
    expect(timing.spans).toEqual([
        { kind: "thinking", startedAt: 1_000, durationMs: 400 },
        { kind: "output", startedAt: 1_400, durationMs: 200 },
        {
            kind: "tool",
            startedAt: 1_600,
            durationMs: 600,
            label: "exec_command"
        }
    ]);
    expect(timing.categories.map(({ kind, durationMs, share }) => ({
        kind,
        durationMs,
        share
    }))).toEqual([
        { kind: "waiting", durationMs: 0, share: 0 },
        { kind: "thinking", durationMs: 400, share: 1 / 3 },
        { kind: "output", durationMs: 200, share: 1 / 6 },
        { kind: "toolArgs", durationMs: 0, share: 0 },
        { kind: "tool", durationMs: 600, share: 1 / 2 }
    ]);
});
