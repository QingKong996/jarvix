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

test("hydrates and updates shell tool output", () => {
    const toolCall = {
        type: "toolCall" as const,
        id: "call-1",
        name: "exec_command",
        arguments: { command: "echo hi", cwd: "/tmp", timeoutMs: 1000 }
    };
    const hydrated = transcriptReducer(initialTranscriptState, {
        type: "session.loaded",
        messages: [{
            role: "user",
            content: "run it",
            timestamp: 1
        }, {
            ...message,
            content: [toolCall],
            stopReason: "toolUse"
        }, {
            role: "toolResult",
            toolCallId: "call-1",
            toolName: "exec_command",
            content: "Command exited with code 0.",
            details: {
                kind: "shell.exec_command",
                command: "echo hi",
                output: "hi\n",
                status: "completed"
            },
            isError: false,
            timestamp: 2
        }]
    });

    expect(hydrated.committed[1]?.blocks).toEqual([{
        type: "tool",
        toolCallId: "call-1",
        toolName: "exec_command",
        data: {
            kind: "shell.exec_command",
            command: "echo hi",
            output: "hi\n",
            status: "completed"
        },
        isError: false
    }]);

    const live = transcriptReducer(initialTranscriptState, {
        type: "events.batch",
        events: [
            { type: "start" },
            { type: "done", message: { ...message, content: [toolCall], stopReason: "toolUse" } },
            {
                type: "tool.start",
                toolCallId: "call-1",
                toolName: "exec_command",
                data: {
                    kind: "shell.exec_command",
                    command: "echo hi",
                    output: "",
                    status: "running"
                }
            },
            {
                type: "tool.output",
                toolCallId: "call-1",
                toolName: "exec_command",
                data: { kind: "shell.exec_command", output: "hi\n" }
            },
            {
                type: "tool.end",
                toolCallId: "call-1",
                toolName: "exec_command",
                data: {
                    kind: "shell.exec_command",
                    command: "echo hi",
                    output: "hi\n",
                    status: "completed"
                },
                isError: false
            }
        ]
    });

    expect(live.committed[0]?.blocks[0]).toMatchObject({
        type: "tool",
        data: { output: "hi\n", status: "completed" }
    });

    const continued = transcriptReducer(live, {
        type: "events.batch",
        events: [{
            type: "tool.output",
            toolCallId: "call-1",
            toolName: "exec_command",
            data: { kind: "shell.exec_command", output: "later\n" }
        }]
    });

    expect(continued.committed[0]?.blocks[0]).toMatchObject({
        type: "tool",
        data: { output: "hi\nlater\n", status: "completed" }
    });
});

test("renders background task exit notices from events and history", () => {
    const notice = {
        kind: "background.task_exit" as const,
        sessionId: "shell-1",
        exitCode: 1,
        errorMessage: null,
        unreadCharacters: 24
    };
    const systemMessage = {
        role: "system" as const,
        content: "Background task exited.",
        timestamp: 3,
        notice
    };
    const live = transcriptReducer(initialTranscriptState, {
        type: "events.batch",
        events: [{ type: "system.message", message: systemMessage }]
    });

    expect(live.committed).toEqual([expect.objectContaining({
        role: "system",
        notice
    })]);

    const hydrated = transcriptReducer(initialTranscriptState, {
        type: "session.loaded",
        messages: [systemMessage]
    });
    expect(hydrated.committed).toEqual([expect.objectContaining({
        role: "system",
        notice
    })]);
});
