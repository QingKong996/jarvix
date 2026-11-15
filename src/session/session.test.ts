import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import type { LlmAdapter } from "../llm/index.ts";
import type {
    LlmAssistantMessage,
    LlmMessage,
    LlmModelInfo,
    LlmStreamEvent
} from "../llm/types.ts";
import type { JarvixEvent } from "../protocol/event.ts";
import type { JarvixSessionMeta } from "../protocol/session.ts";
import { Session } from "./session.ts";
import { appendSessionMessage } from "./store.ts";
import { providerConfigSchema } from "../protocol/providers.ts";
import { BackgroundTaskManager, type ToolExecutor } from "../tools/index.ts";

vi.mock("./store.ts", () => ({
    appendSessionMessage: vi.fn()
}));

const persist = vi.mocked(appendSessionMessage);
const meta: JarvixSessionMeta = {
    type: "session",
    version: 1,
    id: "session-test",
    name: "Session test",
    createdAt: 1
};
const MODEL: LlmModelInfo = {
    provider: "test",
    id: "test-model",
    name: "Test",
    reasoning: false,
    contextWindow: 1000,
    maxTokens: 100
};
const TEST_PROVIDER = providerConfigSchema.parse({
    id: "test", name: "Test", protocol: "openai-completions", baseUrl: "http://localhost:8080/v1",
    models: [{ id: "test-model", name: "Test" }]
});
const TEST_CONFIG = {
    providers: [TEST_PROVIDER],
    selectedModel: { provider: TEST_PROVIDER.id, id: "test-model" }
};

beforeEach(() => {
    persist.mockReset();
});

test("uses the configured model, provider credential and reasoning for the request", async () => {
    const provider = providerConfigSchema.parse({
        id: "custom:local", name: "Local", protocol: "openai-completions", baseUrl: "http://localhost:8080/v1",
        apiKey: "provider-key", models: [{ id: "local-chat", name: "Local Chat", reasoning: true }]
    });
    const getModel = vi.fn(() => ({ ...MODEL, provider: provider.id, id: "local-chat" }));
    const stream = vi.fn(() => (async function* (): AsyncIterable<LlmStreamEvent> {})());
    await new Session(meta).request("hello", {
        llm: { getModel, stream },
        config: { providers: [provider], selectedModel: { provider: provider.id, id: "local-chat" }, reasoning: "high" },
        emit: () => undefined
    });
    expect(getModel).toHaveBeenCalledWith(provider.id, "local-chat");
    expect(stream).toHaveBeenCalledWith(expect.objectContaining({
        model: expect.objectContaining({ provider: provider.id, id: "local-chat" }),
        apiKey: "provider-key", reasoning: "high"
    }));
});

test("adds the session working directories to the system prompt", async () => {
    const stream = vi.fn(() => (async function* (): AsyncIterable<LlmStreamEvent> {})());
    await new Session(meta).request("hello", {
        llm: { getModel: () => MODEL, stream },
        config: TEST_CONFIG,
        workingDirectories: ["C:\\workspace-a", "C:\\workspace-b"],
        emit: () => undefined
    });

    expect(stream).toHaveBeenCalledWith(expect.objectContaining({
        systemPrompt: expect.stringContaining("C:\\workspace-a\n- C:\\workspace-b")
    }));
});

test("retries persistence once and dequeues the message on success", async () => {
    persist.mockImplementationOnce(() => {
        throw new Error("disk full");
    });
    const session = new Session(meta);

    await session.request("first", {
        llm: fakeLlm(assistantMessage()),
        config: TEST_CONFIG,
        emit: () => undefined
    });

    expect(persist).toHaveBeenCalledTimes(3);
    expect(persist.mock.calls.map(([, message]) => message.role)).toEqual([
        "user",
        "user",
        "assistant"
    ]);
    expect(persist.mock.calls[0]?.[1]).toBe(persist.mock.calls[1]?.[1]);
    expect(session.snapshot().messages.map((message) => message.role)).toEqual([
        "user",
        "assistant"
    ]);
});

test("keeps failed messages queued and flushes them in order", async () => {
    persist.mockImplementation(() => {
        throw new Error("disk full");
    });
    const session = new Session(meta);
    const runtime = {
        llm: fakeLlm(assistantMessage()),
        config: TEST_CONFIG,
        emit: () => undefined
    };

    await expect(session.request("first", runtime)).rejects.toThrow(/after 2 attempts/);
    expect(persist).toHaveBeenCalledTimes(2);
    expect(session.snapshot().messages).toEqual([
        expect.objectContaining({ role: "user", content: "first" })
    ]);

    persist.mockReset();
    await session.request("second", {
        llm: fakeLlm(assistantMessage()),
        config: TEST_CONFIG,
        emit: () => undefined
    });

    const persisted = persist.mock.calls.map(([, message]) => message);
    expect(persisted[0]).toBe(session.snapshot().messages[0]);
    expect(persisted[1]).toEqual(expect.objectContaining({ role: "user", content: "second" }));
    expect(persisted.map((message) => message.role)).toEqual(["user", "user", "assistant"]);
    expect(session.snapshot().messages.map((message) => message.role)).toEqual([
        "user",
        "user",
        "assistant"
    ]);
});

test("forwards done before persisting its complete assistant message", async () => {
    const timeline: string[] = [];
    persist.mockImplementation((_id, message) => {
        timeline.push(`persist:${message.role}`);
    });
    const events: JarvixEvent[] = [];
    const session = new Session(meta);

    await session.request("hello", {
        llm: fakeLlm(assistantMessage()),
        config: TEST_CONFIG,
        emit: (event) => {
            timeline.push(`event:${event.type}`);
            events.push(event);
        }
    });

    expect(timeline).toEqual(["persist:user", "event:done", "persist:assistant"]);
    expect(events.map((event) => event.type)).toEqual(["done"]);
});

test("retains the forwarded done and in-memory message when persistence fails", async () => {
    persist.mockImplementation((_id, message) => {
        if (message.role === "assistant") {
            throw new Error("disk full");
        }
    });
    const events: JarvixEvent[] = [];
    const session = new Session(meta);

    await expect(session.request("hello", {
        llm: fakeLlm(assistantMessage()),
        config: TEST_CONFIG,
        emit: (event) => {
            events.push(event);
        }
    })).rejects.toThrow(/after 2 attempts/);

    expect(session.snapshot().messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(events.map((event) => event.type)).toEqual(["done", "request.error"]);
    expect(persist.mock.calls.filter(([, message]) => message.role === "assistant")).toHaveLength(2);
    expect(events.at(-1)?.type).toBe("request.error");
});

test("forwards all events and persists only complete done messages in order", async () => {
    const session = new Session(meta);
    const events: JarvixEvent[] = [];
    const completed: LlmStreamEvent = { type: "done", message: assistantMessage() };
    const nextCompleted: LlmStreamEvent = {
        type: "done",
        message: { ...assistantMessage(), content: [{ type: "text", text: "next reply" }] }
    };
    const failed: LlmStreamEvent = {
        type: "error",
        message: { ...assistantMessage(), stopReason: "error", errorMessage: "provider failed" }
    };
    const toolCall: LlmStreamEvent = { type: "toolCall.delta", index: 1, delta: "{}" };

    await session.request("hello", {
        llm: streamLlm((async function* (): AsyncIterable<LlmStreamEvent> {
            yield toolCall;
            yield completed;
            expect(events).toEqual([toolCall, completed]);
            expect(persist.mock.calls.map(([, message]) => message.role)).toEqual(["user", "assistant"]);
            yield nextCompleted;
            yield failed;
            expect(events).toEqual([toolCall, completed, nextCompleted, failed]);
            expect(session.snapshot().messages).toEqual([
                expect.objectContaining({ role: "user" }), completed.message, nextCompleted.message
            ]);
            expect(persist.mock.calls.map(([, message]) => message)).toEqual(session.snapshot().messages);
        })()),
        config: TEST_CONFIG,
        emit: (event) => { events.push(event); }
    });
});

test("retains a completed message when the iterator subsequently throws", async () => {
    const session = new Session(meta);
    const events: JarvixEvent[] = [];
    const message = assistantMessage();

    await expect(session.request("hello", {
        llm: streamLlm((async function* (): AsyncIterable<LlmStreamEvent> {
            yield { type: "done", message };
            throw new Error("stream failed");
        })()),
        config: TEST_CONFIG,
        emit: (event) => { events.push(event); }
    })).rejects.toThrow("stream failed");

    expect(session.snapshot().messages.at(-1)).toBe(message);
    expect(persist).toHaveBeenLastCalledWith(meta.id, message);
    expect(events).toEqual([
        { type: "done", message },
        { type: "request.error", error: "stream failed" }
    ]);
});

test("executes tool calls, streams tool data, and resumes with the tool result", async () => {
    const toolCall = {
        type: "toolCall" as const,
        id: "call-1",
        name: "exec_command",
        arguments: { command: "echo hi", cwd: process.cwd(), timeoutMs: 1000 }
    };
    const toolUseMessage: LlmAssistantMessage = {
        ...assistantMessage(),
        content: [toolCall],
        stopReason: "toolUse"
    };
    const finalMessage = assistantMessage();
    const requests: LlmMessage[][] = [];
    let response = 0;
    const llm: LlmAdapter = {
        getModel: () => MODEL,
        stream(request) {
            requests.push([...request.messages]);
            const message = response === 0 ? toolUseMessage : finalMessage;
            response += 1;
            return (async function* (): AsyncIterable<LlmStreamEvent> {
                yield { type: "start" };
                yield { type: "done", message };
            })();
        }
    };
    const tools: ToolExecutor = {
        definitions: [{
            name: "exec_command",
            description: "Run a command",
            parameters: { type: "object", properties: {} }
        }],
        handles: (name) => name === "exec_command",
        execute: async (_call, observer) => {
            observer.onOutput({ kind: "shell.exec_command", output: "hi\n" });
            return {
                content: "Command exited with code 0.",
                data: {
                    kind: "shell.exec_command",
                    command: "echo hi",
                    output: "hi\n",
                    status: "completed"
                },
                isError: false,
                endReason: "exited"
            };
        },
        dispose: () => undefined
    };
    const events: JarvixEvent[] = [];
    const session = new Session(meta, [], tools);

    await session.request("run it", {
        llm,
        config: TEST_CONFIG,
        emit: (event) => { events.push(event); }
    });

    expect(events.map((event) => event.type)).toEqual([
        "start",
        "done",
        "tool.start",
        "tool.output",
        "tool.end",
        "start",
        "done"
    ]);
    expect(events[3]).toEqual({
        type: "tool.output",
        toolCallId: "call-1",
        toolName: "exec_command",
        data: { kind: "shell.exec_command", output: "hi\n" }
    });
    expect(requests[1]?.map((message) => message.role)).toEqual([
        "user",
        "assistant",
        "toolResult"
    ]);
    expect(requests[1]?.at(-1)).toMatchObject({
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "exec_command",
        content: "Command exited with code 0."
    });
    expect(session.snapshot().messages.map((message) => message.role)).toEqual([
        "user",
        "assistant",
        "toolResult",
        "assistant"
    ]);
});

test("routes background task output outside the tool call after timeout", async () => {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-session-task-"));
    const script = join(directory, "task.mjs");
    writeFileSync(script, [
        "process.stdout.write('start\\n');",
        "setTimeout(() => process.stdout.write('later\\n', () => process.exit(0)), 700);"
    ].join("\n"), "utf8");
    const command = process.platform === "win32"
        ? `& ${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`
        : `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`;
    const toolCall = {
        type: "toolCall" as const,
        id: "call-background",
        name: "exec_command",
        arguments: { command, cwd: directory, timeoutMs: 50 }
    };
    const toolUseMessage: LlmAssistantMessage = {
        ...assistantMessage(),
        content: [toolCall],
        stopReason: "toolUse"
    };
    const finalMessage = assistantMessage();
    let response = 0;
    let shellSessionId: string | undefined;
    const llm: LlmAdapter = {
        getModel: () => MODEL,
        stream(request) {
            if (response === 1) {
                const result = request.messages.findLast((message) => message.role === "toolResult");
                shellSessionId = result?.role === "toolResult"
                    ? /sessionId: ([0-9a-f-]+)/.exec(result.content)?.[1]
                    : undefined;
                expect(shellSessionId).toBeTruthy();
            }
            const message = response === 0
                ? toolUseMessage
                : response === 1
                    ? {
                        ...assistantMessage(),
                        content: [{
                            type: "toolCall" as const,
                            id: "call-poll",
                            name: "write_stdin",
                            arguments: { sessionId: shellSessionId, command: "" }
                        }],
                        stopReason: "toolUse" as const
                    }
                    : finalMessage;
            response += 1;
            return (async function* (): AsyncIterable<LlmStreamEvent> {
                yield { type: "done", message };
            })();
        }
    };
    const events: JarvixEvent[] = [];
    const session = new Session(meta, [], new BackgroundTaskManager());

    try {
        await session.request("run in the background", {
            llm,
            config: TEST_CONFIG,
            emit: (event) => { events.push(event); }
        });

        const finalDone = events.findLastIndex((event) => event.type === "done");
        expect(finalDone).toBeGreaterThan(-1);
        expect(events).toContainEqual(expect.objectContaining({
            type: "backgroundTask.start",
            task: expect.objectContaining({
                id: shellSessionId,
                command
            })
        }));
        expect(events).toContainEqual(expect.objectContaining({
            type: "tool.end",
            toolCallId: "call-background",
            endReason: "background",
            data: expect.objectContaining({ status: "timed_out" })
        }));
        await vi.waitFor(() => {
            const laterOutput = events.findIndex((event, index) => (
                index > finalDone &&
                event.type === "backgroundTask.output" &&
                event.taskId === shellSessionId &&
                event.output.includes("later")
            ));
            expect(laterOutput).toBeGreaterThan(finalDone);
            const toolOutput = events.findIndex((event, index) => (
                index > finalDone &&
                event.type === "tool.output"
            ));
            expect(toolOutput).toBe(-1);
            const execCompleted = events.findIndex((event, index) => (
                index > finalDone &&
                event.type === "tool.end" &&
                event.toolCallId === "call-background" &&
                event.data.status === "completed"
            ));
            expect(execCompleted).toBeGreaterThan(finalDone);
            const writeCompleted = events.findIndex((event, index) => (
                index > finalDone &&
                event.type === "tool.end" &&
                event.toolCallId === "call-poll" &&
                event.data.status === "completed"
            ));
            expect(writeCompleted).toBeGreaterThan(finalDone);
            const notices = events.filter((event) => (
                event.type === "system.message" &&
                event.message.notice?.kind === "background.task_exit" &&
                event.message.notice.sessionId === shellSessionId
            ));
            expect(notices).toHaveLength(1);
            expect(notices[0]).toMatchObject({
                message: {
                    notice: {
                        unreadCharacters: expect.any(Number)
                    }
                }
            });
            expect(events).toContainEqual(expect.objectContaining({
                type: "backgroundTask.end",
                task: expect.objectContaining({
                    id: shellSessionId,
                    status: "completed"
                })
            }));
        }, { timeout: 5_000 });
        expect(session.snapshot().messages.at(-1)).toMatchObject({
            role: "system",
            notice: {
                kind: "background.task_exit",
                exitCode: 0
            }
        });
    } finally {
        session.dispose();
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
        rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});

function fakeLlm(message: LlmAssistantMessage): LlmAdapter {
    return streamLlm((async function* (): AsyncIterable<LlmStreamEvent> {
        yield { type: "done", message };
    })());
}

function streamLlm(events: AsyncIterable<LlmStreamEvent>): LlmAdapter {
    return {
        getModel: () => MODEL,
        stream(): AsyncIterable<LlmStreamEvent> {
            return events;
        }
    };
}

function assistantMessage(): LlmAssistantMessage {
    return {
        role: "assistant",
        content: [{ type: "text", text: "reply" }],
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
        stopReason: "stop",
        timestamp: 2
    };
}
