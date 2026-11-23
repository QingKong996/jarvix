import { expect, test, vi } from "vitest";
import type { Tool, ToolExecutionContext, ToolManager } from "./tool-manager.ts";
import { ToolManagerRegistry } from "./tool-manager-registry.ts";
import type { ToolExecutionObserver } from "./types.ts";
import { createGenericToolCallViewData } from "./tool-view.ts";

function echoTool(
    contexts: ToolExecutionContext[],
    dispose: () => void
): Tool {
    return {
        definitions: [{
            name: "external_echo",
            description: "Echo an external value",
            parameters: { type: "object", properties: {} }
        }],
        async execute(call, context) {
            contexts.push(context);
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
        dispose
    };
}

const observer: ToolExecutionObserver = {
    onOutput: () => undefined
};

test("registers managers and passes the session execution context", async () => {
    const contexts: ToolExecutionContext[] = [];
    const dispose = vi.fn();
    const manager: ToolManager = {
        id: "external",
        create: vi.fn(() => [echoTool(contexts, dispose)])
    };
    const registry = new ToolManagerRegistry({
        sessionId: "session-1",
        permission: () => "read-only",
        workingDirectories: () => ["C:\\workspace"]
    });
    const signal = new AbortController().signal;

    registry.registerManager(manager);

    expect(manager.create).toHaveBeenCalledTimes(1);
    expect(registry.handles("external_echo")).toBe(true);
    await expect(registry.execute({
        type: "toolCall",
        id: "call-1",
        name: "external_echo",
        arguments: { text: "hello" }
    }, observer, signal)).resolves.toMatchObject({
        content: "echo:hello"
    });
    expect(contexts[0]).toMatchObject({
        sessionId: "session-1",
        permission: "read-only",
        workingDirectories: ["C:\\workspace"],
        signal
    });

    await registry.unregisterManager("external");

    expect(registry.handles("external_echo")).toBe(false);
    expect(dispose).toHaveBeenCalledTimes(1);
});

test("waits for an active tool call before disposing an unloaded manager", async () => {
    let release!: () => void;
    const dispose = vi.fn();
    const manager: ToolManager = {
        id: "external",
        create: () => [{
            definitions: [{
                name: "external_wait",
                description: "Wait for release",
                parameters: { type: "object", properties: {} }
            }],
            execute: async (call) => {
                await new Promise<void>((resolve) => {
                    release = resolve;
                });
                return {
                    content: "released",
                    data: createGenericToolCallViewData(
                        call.name,
                        call.arguments,
                        "completed"
                    ),
                    isError: false,
                    endReason: "exited"
                };
            },
            dispose
        }]
    };
    const registry = new ToolManagerRegistry({
        sessionId: "session-1",
        permission: () => "read-only",
        workingDirectories: () => []
    });
    registry.registerManager(manager);

    const call = registry.execute({
        type: "toolCall",
        id: "call-1",
        name: "external_wait",
        arguments: {}
    }, observer);
    let unloaded = false;
    const unload = registry.unregisterManager("external").then(() => {
        unloaded = true;
    });

    await Promise.resolve();
    expect(unloaded).toBe(false);

    release();
    await call;
    await unload;

    expect(unloaded).toBe(true);
    expect(dispose).toHaveBeenCalledTimes(1);
});
