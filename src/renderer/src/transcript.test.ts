import { expect, test } from "vitest";
import type { LlmAssistantMessage } from "../../llm/types.ts";
import { initialTranscriptState, transcriptReducer } from "./transcript.ts";

const message: LlmAssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text: "complete response" }],
    provider: "test",
    model: "test",
    api: "test",
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, cost: 0 },
    stopReason: "stop",
    timestamp: 1
};

test("renders authoritative messages across successive stream lifecycles", () => {
    const state = transcriptReducer(initialTranscriptState, {
        type: "events.batch",
        events: [
            { type: "start" },
            { type: "text.delta", index: 0, delta: "partial" },
            { type: "toolCall.delta", index: 1, delta: "{}" },
            { type: "done", message },
            { type: "start" },
            { type: "error", message: { ...message, stopReason: "error", errorMessage: "provider failed" } }
        ]
    });

    expect(state.live).toBeNull();
    expect(state.committed).toHaveLength(2);
    expect(state.committed[0]?.blocks).toEqual([{ type: "text", text: "complete response" }]);
    expect(state.committed[1]).toMatchObject({
        blocks: [{ type: "text", text: "complete response" }],
        error: "provider failed",
        reason: "error"
    });
    expect(new Set(state.committed.map((turn) => turn.id)).size).toBe(2);
});

test("keeps streamed content when a request fails before a complete message", () => {
    const state = transcriptReducer(initialTranscriptState, {
        type: "events.batch",
        events: [
            { type: "start" },
            { type: "text.delta", index: 0, delta: "partial" },
            { type: "request.error", error: "disk full" }
        ]
    });

    expect(state.live).toBeNull();
    expect(state.committed[0]).toMatchObject({
        blocks: [{ type: "text", text: "partial" }],
        error: "disk full",
        reason: null
    });
});
