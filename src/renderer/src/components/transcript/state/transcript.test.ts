import { expect, test, vi } from "vitest";
import type { LlmAssistantMessage } from "../../../../../protocol/llm.ts";
import {
    MAX_TOOL_OUTPUT_CHARS,
    OUTPUT_TRUNCATION_NOTICE
} from "../../../../../runtime/tools/output.ts";
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

test("shows request errors after the live response has already completed", () => {
    const started = transcriptReducer(initialTranscriptState, {
        type: "turn.send",
        userId: "user-1",
        assistantId: "assistant-1",
        text: "use a tool"
    });
    const toolTurn = transcriptReducer(started, {
        type: "events.batch",
        events: [{ type: "done", message }]
    });

    const failed = transcriptReducer(toolTurn, {
        type: "events.batch",
        events: [{ type: "request.error", error: "Context window exceeded" }]
    });
    const duplicate = transcriptReducer(failed, {
        type: "request.error",
        error: "Context window exceeded"
    });

    expect(failed.live).toBeNull();
    expect(failed.committed.at(-1)).toMatchObject({
        role: "assistant",
        blocks: [],
        error: "Context window exceeded"
    });
    expect(duplicate.committed).toEqual(failed.committed);
});

test("keeps streamed thinking and text when the turn is stopped", () => {
    const started = transcriptReducer(initialTranscriptState, {
        type: "turn.send",
        userId: "user-1",
        assistantId: "assistant-1",
        text: "hello"
    });
    const streaming = transcriptReducer(started, {
        type: "events.batch",
        events: [
            { type: "start" },
            { type: "thinking.delta", index: 0, delta: "plan" },
            { type: "text.delta", index: 1, delta: "partial" }
        ]
    });

    const stopped = transcriptReducer(streaming, { type: "turn.stop" });

    expect(stopped.live).toBeNull();
    expect(stopped.committed.at(-1)).toMatchObject({
        role: "assistant",
        blocks: [
            { type: "thinking", thinking: "plan" },
            { type: "text", text: "partial" }
        ],
        error: null,
        reason: "aborted"
    });
});

test("shows an injected prompt below the live response until it enters the next round", () => {
    const started = transcriptReducer(initialTranscriptState, {
        type: "turn.send",
        userId: "user-1",
        assistantId: "assistant-1",
        text: "first"
    });
    const streaming = transcriptReducer(started, {
        type: "events.batch",
        events: [
            { type: "start" },
            { type: "text.delta", index: 0, delta: "working" }
        ]
    });
    const injected = transcriptReducer(streaming, {
        type: "turn.inject",
        userId: "user-2",
        text: "follow up"
    });

    expect(injected.committed.map((turn) => turn.role)).toEqual(["user"]);
    expect(injected.live?.blocks).toEqual([{ index: 0, kind: "text", text: "working" }]);
    expect(injected.injected).toEqual([expect.objectContaining({
        id: "user-2",
        role: "user",
        text: "follow up"
    })]);

    const completed = transcriptReducer(injected, {
        type: "events.batch",
        events: [{ type: "done", message }]
    });
    const nextRound = transcriptReducer(completed, {
        type: "events.batch",
        events: [
            { type: "prompt.injected", promptId: "user-2", text: "follow up" },
            { type: "start" }
        ]
    });

    expect(nextRound.injected).toEqual([]);
    expect(nextRound.committed.map((turn) => turn.role)).toEqual(["user", "assistant", "user"]);
    expect(nextRound.committed[2]?.text).toBe("follow up");
    expect(nextRound.live).not.toBeNull();
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
        isError: false,
        endReason: "exited"
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
                    status: "timed_out"
                },
                isError: false,
                endReason: "background"
            }
        ]
    });

    expect(live.committed[0]?.blocks[0]).toMatchObject({
        type: "tool",
        data: { output: "hi\n", status: "timed_out" },
        endReason: "background"
    });

    const afterEnd = transcriptReducer(live, {
        type: "events.batch",
        events: [{
            type: "tool.output",
            toolCallId: "call-1",
            toolName: "exec_command",
            data: { kind: "shell.exec_command", output: "later\n" }
        }]
    });

    expect(afterEnd.committed[0]?.blocks[0]).toMatchObject({
        type: "tool",
        data: { output: "hi\n", status: "timed_out" },
        endReason: "background"
    });
});

test("restores view_image data URLs from persisted image content", () => {
    const hydrated = transcriptReducer(initialTranscriptState, {
        type: "session.loaded",
        messages: [{
            ...message,
            content: [{
                type: "toolCall",
                id: "call-image",
                name: "view_image",
                arguments: { path: "pixel.png" }
            }],
            stopReason: "toolUse"
        }, {
            role: "toolResult",
            toolCallId: "call-image",
            toolName: "view_image",
            content: [{
                type: "image",
                data: "aW1hZ2U=",
                mimeType: "image/png"
            }],
            details: {
                kind: "image.view_image",
                path: "pixel.png",
                mimeType: "image/png",
                imageUrl: "",
                output: "",
                status: "completed"
            },
            isError: false,
            timestamp: 2
        }]
    });

    expect(hydrated.committed[0]?.blocks[0]).toMatchObject({
        type: "tool",
        data: {
            kind: "image.view_image",
            imageUrl: "data:image/png;base64,aW1hZ2U="
        }
    });
});

test("bounds streamed shell output retained by the transcript", () => {
    const toolCall = {
        type: "toolCall" as const,
        id: "call-large",
        name: "exec_command",
        arguments: { command: "generate output", cwd: "/tmp", timeoutMs: 1_000 }
    };
    const state = transcriptReducer(initialTranscriptState, {
        type: "events.batch",
        events: [
            { type: "start" },
            {
                type: "done",
                message: { ...message, content: [toolCall], stopReason: "toolUse" }
            },
            {
                type: "tool.start",
                toolCallId: "call-large",
                toolName: "exec_command",
                data: {
                    kind: "shell.exec_command",
                    command: "generate output",
                    output: "",
                    status: "running"
                }
            },
            {
                type: "tool.output",
                toolCallId: "call-large",
                toolName: "exec_command",
                data: {
                    kind: "shell.exec_command",
                    output: `${"x".repeat(MAX_TOOL_OUTPUT_CHARS)}tail`
                }
            }
        ]
    });
    const block = state.committed[0]?.blocks[0];

    if (block?.type !== "tool") {
        throw new Error("Expected a shell tool block.");
    }
    expect(block).toMatchObject({
        type: "tool",
        data: {
            kind: "shell.exec_command",
            output: expect.stringContaining("tail")
        }
    });
    expect(block.data.output.length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_CHARS);
    expect(block.data.output).toContain(OUTPUT_TRUNCATION_NOTICE);
});

test("updates repeated tool output without scanning unrelated committed blocks", () => {
    const toolCall = {
        type: "toolCall" as const,
        id: "call-active",
        name: "exec_command",
        arguments: { command: "generate output", cwd: "/tmp", timeoutMs: 1_000 }
    };
    const history = Array.from({ length: 1_000 }, (_, index) => ({
        role: "user" as const,
        content: `earlier message ${index}`,
        timestamp: index
    }));
    const initial = transcriptReducer(initialTranscriptState, {
        type: "session.loaded",
        messages: [
            ...history,
            {
                ...message,
                content: [toolCall],
                stopReason: "toolUse"
            }
        ]
    });
    const started = transcriptReducer(initial, {
        type: "events.batch",
        events: [{
            type: "tool.start",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            data: {
                kind: "shell.exec_command",
                command: "generate output",
                output: "",
                status: "running"
            }
        }]
    });
    const unrelatedBlocks = started.committed[0]!.blocks;
    let unrelatedReads = 0;
    Object.defineProperty(started.committed[0]!, "blocks", {
        get() {
            unrelatedReads += 1;
            return unrelatedBlocks;
        }
    });

    const updated = transcriptReducer(started, {
        type: "events.batch",
        events: Array.from({ length: 100 }, () => ({
            type: "tool.output" as const,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            data: { kind: "shell.exec_command" as const, output: "tick\n" }
        }))
    });

    expect(unrelatedReads).toBe(0);
    expect(updated.committed.at(-1)?.blocks[0]).toMatchObject({
        type: "tool",
        data: { output: "tick\n".repeat(100) }
    });
});

test("marks an unfinished shell result as ended after resume", () => {
    const toolCall = {
        type: "toolCall" as const,
        id: "call-write",
        name: "write_stdin",
        arguments: { sessionId: "shell-1", command: "" }
    };
    const hydrated = transcriptReducer(initialTranscriptState, {
        type: "session.loaded",
        messages: [{
            ...message,
            content: [toolCall],
            stopReason: "toolUse"
        }, {
            role: "toolResult",
            toolCallId: "call-write",
            toolName: "write_stdin",
            content: "Shell is still running.",
            details: {
                kind: "shell.write_stdin",
                sessionId: "shell-1",
                command: "",
                output: "tick\n",
                status: "running"
            },
            isError: false,
            timestamp: 2
        }]
    });

    expect(hydrated.committed[0]?.blocks[0]).toMatchObject({
        type: "tool",
        data: { status: "running" },
        endReason: "terminated"
    });
});

test("hydrates many tool results without repeatedly searching earlier calls", () => {
    const toolCalls = Array.from({ length: 512 }, (_, index) => ({
        type: "toolCall" as const,
        id: `call-${index}`,
        name: "exec_command",
        arguments: { command: `echo ${index}`, cwd: "/tmp", timeoutMs: 1_000 }
    }));
    const messages = [
        { ...message, content: toolCalls, stopReason: "toolUse" as const },
        ...toolCalls.map((toolCall) => ({
            role: "toolResult" as const,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            content: `result ${toolCall.id}`,
            isError: false,
            timestamp: 2
        }))
    ];
    const findIndex = vi.spyOn(Array.prototype, "findIndex");
    let hydrated;
    try {
        hydrated = transcriptReducer(initialTranscriptState, {
            type: "session.loaded",
            messages
        });
    } finally {
        findIndex.mockRestore();
    }

    expect(findIndex).not.toHaveBeenCalled();
    expect(hydrated.committed[0]?.blocks).toHaveLength(toolCalls.length);
    expect(hydrated.committed[0]?.blocks.every(
        (block) => block.type === "tool" && block.data.status === "completed"
    )).toBe(true);
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
        text: "Background task exited."
    })]);

    const hydrated = transcriptReducer(initialTranscriptState, {
        type: "session.loaded",
        messages: [systemMessage]
    });
    expect(hydrated.committed).toEqual([expect.objectContaining({
        role: "system",
        text: "Background task exited."
    })]);
});

test("hides the leading environment snapshot and renders user reminders as system turns", () => {
    const hydrated = transcriptReducer(initialTranscriptState, {
        type: "session.loaded",
        messages: [{
            role: "system",
            content: "<environment_context>\n- permission: read-only\n</environment_context>",
            context: "environment",
            environmentKey: "[\"read-only\",[]]",
            timestamp: 1
        }, {
            role: "user",
            content: "hello",
            timestamp: 2
        }, {
            role: "user",
            content: [
                "<system-reminder>",
                "The session environment changed.",
                "<environment_context>",
                "- permission: full-access",
                "</environment_context>",
                "</system-reminder>"
            ].join("\n"),
            context: "system-reminder",
            timestamp: 3
        }]
    });

    expect(hydrated.committed.map((turn) => turn.role)).toEqual(["user", "system"]);
    expect(hydrated.committed[1]?.text).toContain("permission: full-access");
    expect(hydrated.committed[1]?.text).not.toContain("<system-reminder>");
});
