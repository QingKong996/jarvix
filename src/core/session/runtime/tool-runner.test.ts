import { expect, test, vi } from "vitest";
import type {
    LlmImageContent,
    LlmMessage,
    LlmToolCallBlock
} from "../../../protocol/llm.ts";
import type { ToolExecutor } from "../../../runtime/tools/index.ts";
import { createGenericToolCallViewData } from "../../../runtime/tools/tool-view.ts";
import { SessionPermissions } from "../../permissions/session-permissions.ts";
import {
    noopAgentObserver,
    type AgentToolFinished
} from "../../observability/index.ts";
import { ToolCallRunner } from "./tool-runner.ts";
import type { SessionRuntime } from "./types.ts";

test("writes image results into the persisted tool result content", async () => {
    const image: LlmImageContent = {
        type: "image",
        data: "aW1hZ2U=",
        mimeType: "image/png"
    };
    const appended: LlmMessage[] = [];
    const tools: ToolExecutor = {
        definitions: [{
            name: "view_image",
            description: "View an image",
            parameters: { type: "object", properties: {} }
        }],
        handles: (name) => name === "view_image",
        execute: async (call) => ({
            content: "",
            images: [image],
            data: createGenericToolCallViewData(call.name, call.arguments, "completed"),
            isError: false,
            endReason: "exited"
        }),
        stop: async () => [],
        dispose: () => undefined
    };
    const runner = new ToolCallRunner({
        tools,
        permissions: new SessionPermissions(),
        append: (message) => appended.push(message),
        queueBackgroundExitNotice: () => undefined
    });
    const toolCall: LlmToolCallBlock = {
        type: "toolCall",
        id: "call-image",
        name: "view_image",
        arguments: { path: "image.png" }
    };
    const runtime = {
        emit: vi.fn()
    } as unknown as SessionRuntime;

    try {
        await runner.execute(toolCall, runtime, new AbortController().signal);
    } finally {
        runner.dispose();
    }

    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
        role: "toolResult",
        toolCallId: "call-image",
        content: [image]
    });
});

test("classifies structured tool failures without exposing tool output", async () => {
    const finished: AgentToolFinished[] = [];
    let output = "";
    const tools: ToolExecutor = {
        definitions: [{
            name: "exec_command",
            description: "Run a command",
            parameters: { type: "object", properties: {} }
        }],
        handles: (name) => name === "exec_command",
        execute: async (call) => ({
            content: output,
            data: createGenericToolCallViewData(call.name, call.arguments, "failed"),
            isError: true,
            endReason: "exited"
        }),
        stop: async () => [],
        dispose: () => undefined
    };
    const runner = new ToolCallRunner({
        tools,
        permissions: new SessionPermissions(),
        append: () => undefined,
        queueBackgroundExitNotice: () => undefined,
        observer: {
            ...noopAgentObserver,
            toolFinished: (_toolSpanId, tool) => {
                finished.push(tool);
            }
        }
    });
    const runtime = {
        emit: vi.fn()
    } as unknown as SessionRuntime;
    const cases = [
        ["Permission denied", "tool_permission_denied"],
        ["Path not found", "tool_not_found"],
        ["Invalid JSON arguments", "tool_invalid_arguments"],
        ["Command timed out", "tool_timeout"],
        ["", "tool_empty_result"],
        ["unexpected failure", "tool_failed"]
    ] as const;

    try {
        for (const [index, [message]] of cases.entries()) {
            output = message;
            await runner.execute({
                type: "toolCall",
                id: `call-${index}`,
                name: "exec_command",
                arguments: { command: "test" }
            }, runtime, new AbortController().signal, {
                runId: "run-1",
                turnId: "turn-1",
                turnIndex: 0,
                stepIndex: index,
                repeatIndex: 0,
                repeatGroupSize: 1
            });
        }
    } finally {
        runner.dispose();
    }

    expect(finished.map((tool) => tool.errorCode)).toEqual(
        cases.map(([, errorCode]) => errorCode)
    );
    expect(JSON.stringify(finished)).not.toContain("unexpected failure");
});
