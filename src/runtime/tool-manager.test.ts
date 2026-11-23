import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test, vi } from "vitest";
import type {
    LlmAssistantMessage,
    LlmMessage,
    LlmModelInfo,
    LlmStreamEvent,
    LlmToolCallBlock
} from "../protocol/llm.ts";
import type { LlmAdapter } from "../core/llm/index.ts";
import { providerConfigSchema } from "../protocol/providers.ts";
import { Jarvix } from "../core/index.ts";
import type { ToolManager } from "./tools/tool-manager.ts";
import { createGenericToolCallViewData } from "./tools/tool-view.ts";

const home = vi.hoisted(() => ({ path: "" }));

vi.mock("node:os", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:os")>();
    return { ...actual, homedir: () => home.path };
});

const base = mkdtempSync(join(tmpdir(), "jarvix-tool-manager-"));
const MODEL: LlmModelInfo = {
    provider: "test",
    id: "test-model",
    name: "Test",
    reasoning: false,
    contextWindow: 1000,
    maxTokens: 100
};
const TEST_PROVIDER = providerConfigSchema.parse({
    id: MODEL.provider,
    name: MODEL.name,
    protocol: "openai-completions",
    baseUrl: "http://localhost:8080/v1",
    models: [{ id: MODEL.id, name: MODEL.name }]
});
const TEST_CONFIG = {
    providers: [TEST_PROVIDER],
    selectedModel: { provider: TEST_PROVIDER.id, id: MODEL.id }
};

afterAll(() => {
    rmSync(base, { recursive: true, force: true });
});

function assistantMessage(
    content: LlmAssistantMessage["content"],
    stopReason: LlmAssistantMessage["stopReason"] = "stop"
): LlmAssistantMessage {
    return {
        role: "assistant",
        content,
        provider: MODEL.provider,
        model: MODEL.id,
        api: "test",
        usage: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 0,
            cost: 0
        },
        stopReason,
        timestamp: Date.now()
    };
}

function streamMessage(message: LlmAssistantMessage): AsyncIterable<LlmStreamEvent> {
    return (async function* (): AsyncIterable<LlmStreamEvent> {
        yield { type: "done", message };
    })();
}

test("registers and unloads a manager for loaded and new sessions", async () => {
    home.path = join(base, "dynamic-home");
    const seen: LlmMessage[][] = [];
    const sessionIds: string[] = [];
    let response = 0;
    const llm: LlmAdapter = {
        getModel: () => MODEL,
        stream(request) {
            seen.push([...request.messages]);
            const toolCall: LlmToolCallBlock = {
                type: "toolCall",
                id: `external-call-${response}`,
                name: "external_echo",
                arguments: { text: "hello" }
            };
            const message = response % 2 === 0
                ? assistantMessage([toolCall], "toolUse")
                : assistantMessage([{ type: "text", text: "done" }]);
            response += 1;
            return streamMessage(message);
        }
    };
    const toolDispose = vi.fn();
    const managerDispose = vi.fn();
    const manager: ToolManager = {
        id: "external",
        create(context) {
            sessionIds.push(context.sessionId);
            return [{
                definitions: [{
                    name: "external_echo",
                    description: "Echo an external value",
                    parameters: { type: "object", properties: {} }
                }],
                async execute(call) {
                    return {
                        content: `echo:${String(call.arguments.text)}`,
                        data: createGenericToolCallViewData(
                            call.name,
                            call.arguments,
                            "completed"
                        ),
                        isError: false,
                        endReason: "exited"
                    };
                },
                dispose: toolDispose
            }];
        },
        dispose: managerDispose
    };
    const jarvix = new Jarvix({ llm, config: TEST_CONFIG });

    try {
        const first = jarvix.createSession({}, "First");
        await jarvix.registerToolManager(manager);
        const second = jarvix.createSession({}, "Second");

        expect(sessionIds).toEqual([first.meta.id, second.meta.id]);

        await jarvix.request("use the external tool", first.meta.id);
        expect(seen[1]).toContainEqual(expect.objectContaining({
            role: "toolResult",
            toolName: "external_echo",
            content: "echo:hello"
        }));

        expect(await jarvix.unregisterToolManager("external")).toBe(true);
        expect(toolDispose).toHaveBeenCalledTimes(2);
        expect(managerDispose).toHaveBeenCalledTimes(1);

        await jarvix.request("use the external tool again", first.meta.id);
        expect(seen[3]).toContainEqual(expect.objectContaining({
            role: "toolResult",
            toolName: "external_echo",
            content: "Unknown tool: external_echo"
        }));
        expect(await jarvix.unregisterToolManager("external")).toBe(false);
    } finally {
        jarvix.dispose();
    }
});
