import { expect, test, vi } from "vitest";
import type {
    LlmImageContent,
    LlmMessage,
    LlmToolCallBlock
} from "../../../protocol/llm.ts";
import type { ToolExecutor } from "../../../runtime/tools/index.ts";
import { createGenericToolCallViewData } from "../../../runtime/tools/tool-view.ts";
import { SessionPermissions } from "../../permissions/session-permissions.ts";
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
