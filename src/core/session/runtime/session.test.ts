import {
    mkdirSync,
    mkdtempSync,
    rmSync,
    writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import type { LlmAdapter, LlmRequest } from "../../llm/index.ts";
import type {
    LlmAssistantMessage,
    LlmMessage,
    LlmModelInfo,
    LlmStreamEvent
} from "../../../protocol/llm.ts";
import { toolResultContentText } from "../../../protocol/llm.ts";
import type { JarvixEvent } from "../../../protocol/event.ts";
import { DEFAULT_PERMISSION_MODE } from "../../../protocol/permission.ts";
import type { JarvixSessionMeta } from "../../../protocol/session.ts";
import { MAX_TOOL_ROUNDS, Session } from "./session.ts";
import {
    appendSessionCompaction,
    appendSessionMessage
} from "../persistence/store.ts";
import { messageRecordId } from "../persistence/records.ts";
import { providerConfigSchema } from "../../../protocol/providers.ts";
import {
    type ToolExecutor
} from "../../../runtime/tools/index.ts";
import {
    BackgroundTaskManager,
    REQUEST_PERMISSION_TOOL
} from "../../../runtime/tools/index.ts";
import { SessionPermissions } from "../../permissions/session-permissions.ts";
import { estimateContextUsage } from "./context-usage.ts";
import {
    DefaultContextManager,
    createDefaultContextManager,
    type ContextManagerFactory
} from "./context-manager.ts";
import { AgentInstructions } from "./agent-instructions.ts";
import { SYSTEM_PROMPT } from "./environment.ts";
import { CONTEXT_COMPACTION_SYSTEM_PROMPT } from "./context-compaction.ts";
import { createGenericToolCallViewData } from "../../../runtime/tools/tool-view.ts";
import { noopAgentObserver } from "../../observability/index.ts";

const testHome = vi.hoisted(() => ({ path: "" }));

vi.mock("node:os", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:os")>();
    return { ...actual, homedir: () => testHome.path };
});

vi.mock("../persistence/store.ts", () => ({
    appendSessionMessage: vi.fn(),
    appendSessionCompaction: vi.fn()
}));

const persist = vi.mocked(appendSessionMessage);
const persistCompaction = vi.mocked(appendSessionCompaction);
const meta: JarvixSessionMeta = {
    type: "session",
    version: 1,
    id: "session-test",
    name: "Session test",
    createdAt: 1,
    status: "active",
    permission: DEFAULT_PERMISSION_MODE
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
const SMALL_CONTEXT_PROVIDER = providerConfigSchema.parse({
    id: "test",
    name: "Test",
    protocol: "openai-completions",
    baseUrl: "http://localhost:8080/v1",
    models: [{
        id: "test-model",
        name: "Test",
        contextWindow: 3_000,
        maxTokens: 100
    }]
});
const SMALL_CONTEXT_CONFIG = {
    providers: [SMALL_CONTEXT_PROVIDER],
    selectedModel: { provider: SMALL_CONTEXT_PROVIDER.id, id: "test-model" }
};
const COMPACTION_PROVIDER = providerConfigSchema.parse({
    id: "test",
    name: "Test",
    protocol: "openai-completions",
    baseUrl: "http://localhost:8080/v1",
    models: [{
        id: "test-model",
        name: "Test",
        contextWindow: 30_000,
        maxTokens: 1_000
    }]
});
const COMPACTION_MODEL: LlmModelInfo = {
    ...MODEL,
    contextWindow: 30_000,
    maxTokens: 1_000
};
const COMPACTION_CONFIG = {
    providers: [COMPACTION_PROVIDER],
    selectedModel: {
        provider: COMPACTION_PROVIDER.id,
        id: "test-model"
    },
    contextCompactionThreshold: 5_000
};
const NO_TOOLS: ToolExecutor = {
    definitions: [],
    handles: () => false,
    execute: async () => {
        throw new Error("No tools are available");
    },
    stop: async () => [],
    dispose: () => undefined
};

beforeEach(() => {
    testHome.path = join(tmpdir(), `jarvix-session-home-${process.pid}`);
    persist.mockReset();
    persistCompaction.mockReset();
});

test("uses the configured model, provider credential and reasoning for the request", async () => {
    const provider = providerConfigSchema.parse({
        id: "custom:local", name: "Local", protocol: "openai-completions", baseUrl: "http://localhost:8080/v1",
        apiKey: "provider-key", models: [{ id: "local-chat", name: "Local Chat", reasoning: true }]
    });
    const getModel = vi.fn(() => ({ ...MODEL, provider: provider.id, id: "local-chat" }));
    const stream = vi.fn(() => (async function* (): AsyncIterable<LlmStreamEvent> {
        yield { type: "done", message: assistantMessage() };
    })());
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

test("assembles the final provider context without mutating the session", () => {
    const session = new Session(meta);

    const context = session.providerContext(["C:\\workspace-a"]);

    expect(context.systemPrompt).toContain("You are Jarvix");
    expect(context.systemPrompt).toContain("AGENTS.md");
    expect(context.systemPrompt).toContain("apply_patch");
    expect(context.systemPrompt).toContain(`Current operating system: ${process.platform}.`);
    expect(context.systemPrompt).not.toMatch(/respond to the user|Chinese/i);
    expect(context.messages[0]).toMatchObject({
        role: "system",
        context: "injected",
        content: expect.stringContaining("- C:\\workspace-a")
    });
    expect(context.breakdown?.systemPrompt).toBeGreaterThan(0);
    expect(context.breakdown?.injected).toBeGreaterThan(0);
    expect(session.snapshot().messages).toEqual([]);
});

test("drops persisted injection messages before restoring fresh snapshots", () => {
    const session = new Session(meta, [
        {
            role: "system",
            content: "old environment snapshot",
            context: "environment",
            timestamp: 1
        },
        {
            role: "system",
            content: "old injected context",
            context: "injected",
            timestamp: 2
        },
        {
            role: "user",
            content: "old reminder",
            context: "system-reminder",
            timestamp: 3
        },
        {
            role: "user",
            content: "hello",
            timestamp: 4
        },
        assistantMessage()
    ]);

    const context = session.providerContext(["C:\\workspace-a"]);

    expect(context.messages.some((message) => (
        message.role === "system"
        && (
            message.content === "old environment snapshot"
            || message.content === "old injected context"
        )
    ))).toBe(false);
    expect(context.messages.some((message) => (
        message.role === "user" && message.content === "old reminder"
    ))).toBe(false);
    expect(context.messages.filter((message) => (
        message.role === "system"
        && message.content.includes("<environment_context>")
    ))).toHaveLength(1);
    expect(session.snapshot().messages.map((message) => message.role)).toEqual([
        "user",
        "assistant"
    ]);
});

test("creates one context manager per session", () => {
    const factory = vi.fn(createDefaultContextManager);

    new Session(meta, [], NO_TOOLS, undefined, factory);
    new Session(meta, [], NO_TOOLS, undefined, factory);

    expect(factory).toHaveBeenCalledTimes(2);
});

test("keeps working directories out of the system prompt and in the leading environment context", async () => {
    const stream = vi.fn((_request: LlmRequest) => (
        async function* (): AsyncIterable<LlmStreamEvent> {
            yield { type: "done", message: assistantMessage() };
        }
    )());
    await new Session(meta).request("hello", {
        llm: { getModel: () => MODEL, stream },
        config: TEST_CONFIG,
        workingDirectories: ["C:\\workspace-a", "C:\\workspace-b"],
        emit: () => undefined
    });

    const request = stream.mock.calls[0]?.[0];
    expect(request?.systemPrompt).not.toContain("C:\\workspace-a");
    expect(request?.messages[0]).toMatchObject({
        role: "system",
        context: "injected",
        content: expect.stringContaining("- C:\\workspace-a\n- C:\\workspace-b")
    });
});

test("reports a model stream that ends without a completion event", async () => {
    const session = new Session(meta);
    const events: JarvixEvent[] = [];
    const stream = vi.fn(() => (async function* (): AsyncIterable<LlmStreamEvent> {
        yield { type: "start" };
        yield { type: "text.delta", index: 0, delta: "partial" };
    })());

    await expect(session.request("hello", {
        llm: { getModel: () => MODEL, stream },
        config: TEST_CONFIG,
        emit: (event) => events.push(event)
    })).rejects.toThrow("Model response ended without a completion event");

    expect(events).toContainEqual({
        type: "request.error",
        error: "Model response ended without a completion event"
    });
    expect(session.snapshot().messages).toEqual([expect.objectContaining({
        role: "user",
        content: "hello"
    })]);
});

test("persists the user prompt when model setup fails", async () => {
    const session = new Session(meta);
    const events: JarvixEvent[] = [];
    const stream = vi.fn(() => (async function* (): AsyncIterable<LlmStreamEvent> {
        yield { type: "done", message: assistantMessage() };
    })());

    await expect(session.request("keep this prompt", {
        llm: { getModel: () => MODEL, stream },
        config: {},
        emit: (event) => events.push(event)
    })).rejects.toThrow("No model configured");

    expect(stream).not.toHaveBeenCalled();
    expect(events).toContainEqual({
        type: "request.error",
        error: "No model configured"
    });
    expect(session.snapshot().messages).toEqual([
        expect.objectContaining({
            role: "user",
            content: "keep this prompt"
        })
    ]);
    expect(persist).toHaveBeenCalledWith(
        meta.id,
        expect.objectContaining({
            role: "user",
            content: "keep this prompt"
        })
    );
});

test("registers request_permission unless the session has full access", async () => {
    const toolNames: string[][] = [];
    const llm: LlmAdapter = {
        getModel: () => MODEL,
        stream(request) {
            toolNames.push(request.tools?.map((tool) => tool.name) ?? []);
            return (async function* (): AsyncIterable<LlmStreamEvent> {
                yield { type: "done", message: assistantMessage() };
            })();
        }
    };
    const session = new Session({ ...meta, permission: "read-only" });
    const runtime = {
        llm,
        config: TEST_CONFIG,
        emit: () => undefined
    };

    await session.request("read-only", runtime);
    session.applyPermission("auto-review");
    await session.request("auto-review", runtime);
    session.applyPermission("full-access");
    await session.request("full-access", runtime);

    expect(toolNames[0]).toContain(REQUEST_PERMISSION_TOOL);
    expect(toolNames[1]).toContain(REQUEST_PERMISSION_TOOL);
    expect(toolNames[2]).not.toContain(REQUEST_PERMISSION_TOOL);
});

test("keeps one leading environment injection and appends changes as injected context", async () => {
    const requests: LlmMessage[][] = [];
    const llm: LlmAdapter = {
        getModel: () => MODEL,
        stream(request) {
            requests.push([...request.messages]);
            return (async function* (): AsyncIterable<LlmStreamEvent> {
                yield { type: "done", message: assistantMessage() };
            })();
        }
    };
    const session = new Session({ ...meta, permission: "read-only" });
    const runtime = {
        llm,
        config: TEST_CONFIG,
        workingDirectories: ["C:\\workspace-a", "C:\\workspace-b"],
        emit: () => undefined
    };

    await session.request("first", runtime);
    session.applyPermission("project-read-write");
    await session.request("second", runtime);
    session.applyPermission("full-access");
    await session.request("third", runtime);

    const firstSnapshot = requests[0]?.[0];
    const secondSnapshot = requests[1]?.[0];
    const thirdSnapshot = requests[2]?.[0];
    expect(firstSnapshot).toMatchObject({
        role: "system",
        context: "injected",
        content: expect.stringContaining("permission: read-only")
    });
    expect(firstSnapshot).toMatchObject({
        content: expect.stringContaining("writable roots: none")
    });
    expect(secondSnapshot).toBe(firstSnapshot);
    expect(thirdSnapshot).toBe(firstSnapshot);
    expect(requests[1]?.at(-2)).toMatchObject({
        role: "system",
        context: "injected",
        content: expect.stringContaining("permission: project-read-write")
    });
    expect(requests[1]?.at(-2)).toMatchObject({
        content: expect.stringContaining("  - C:\\workspace-a\n  - C:\\workspace-b")
    });
    expect(requests[1]?.at(-2)).toMatchObject({
        content: expect.stringContaining("reads: not restricted by Jarvix")
    });
    expect(requests[2]?.at(-2)).toMatchObject({
        role: "system",
        context: "injected",
        content: expect.stringContaining("sandbox: off")
    });
    expect(requests[2]?.at(-2)).toMatchObject({
        content: expect.stringContaining("access: OS permissions only")
    });
    expect(requests[0]?.at(-1)).toMatchObject({ role: "user", content: "first" });
    expect(session.snapshot().messages.some((message) => (
        message.role === "system" && message.context === "injected"
    )))
        .toBe(false);
    expect(persist.mock.calls.some(([, message]) => (
        message.role === "system"
        && message.context === "injected"
        && message.content.includes("The session environment changed.")
    ))).toBe(true);
});

test("appends working-directory changes without rewriting the leading environment snapshot", async () => {
    const requests: LlmMessage[][] = [];
    const llm: LlmAdapter = {
        getModel: () => MODEL,
        stream(request) {
            requests.push([...request.messages]);
            return (async function* (): AsyncIterable<LlmStreamEvent> {
                yield { type: "done", message: assistantMessage() };
            })();
        }
    };
    const session = new Session({ ...meta, permission: "read-only" });

    await session.request("first", {
        llm,
        config: TEST_CONFIG,
        workingDirectories: ["C:\\workspace-a"],
        emit: () => undefined
    });
    await session.request("second", {
        llm,
        config: TEST_CONFIG,
        workingDirectories: ["C:\\workspace-b"],
        emit: () => undefined
    });

    const leadingSnapshot = requests[0]?.[0];
    expect(requests[1]?.[0]).toBe(leadingSnapshot);
    expect(leadingSnapshot).toMatchObject({
        role: "system",
        content: expect.stringContaining("- C:\\workspace-a")
    });
    expect(leadingSnapshot).not.toMatchObject({
        content: expect.stringContaining("- C:\\workspace-b")
    });
    expect(requests[1]?.at(-2)).toMatchObject({
        role: "system",
        context: "injected",
        content: expect.stringContaining("- C:\\workspace-b")
    });
    expect(requests[1]?.at(-2)).toMatchObject({
        content: expect.stringContaining(
            "The session environment changed."
        )
    });
    expect(persist).toHaveBeenCalledWith(
        meta.id,
        expect.objectContaining({
            role: "system",
            context: "injected"
        })
    );
});

test("estimates context from the exact message sequence sent to the model", async () => {
    let sent: LlmRequest | undefined;
    let assembledMessages: LlmMessage[] | undefined;
    let assembledSystemPrompt: string | undefined;
    let firstUsage: ReturnType<Session["contextUsage"]> | undefined;
    const session = new Session({ ...meta, permission: "read-only" });

    await session.request("hello", {
        llm: {
            getModel: () => MODEL,
            stream(request) {
                sent = {
                    ...request,
                    messages: [...request.messages],
                    tools: request.tools ? [...request.tools] : undefined
                };
                const context = session.providerContext(["C:\\workspace-a"]);
                assembledMessages = [...context.messages];
                assembledSystemPrompt = context.systemPrompt;
                return (async function* (): AsyncIterable<LlmStreamEvent> {
                    yield { type: "done", message: assistantMessage() };
                })();
            }
        },
        config: TEST_CONFIG,
        workingDirectories: ["C:\\workspace-a"],
        emit: (event) => {
            if (event.type === "context.usage") {
                firstUsage ??= event.usage;
            }
        }
    });

    expect(sent).toBeDefined();
    expect(assembledMessages).toEqual(sent?.messages);
    expect(assembledSystemPrompt).toBe(sent?.systemPrompt);
    expect(firstUsage).toEqual(estimateContextUsage({
        contextWindow: firstUsage?.contextWindow ?? 1,
        systemPrompt: sent?.systemPrompt,
        messages: sent?.messages ?? [],
        tools: sent?.tools
    }));
});

test("sends complete history even when it exceeds the model context window", async () => {
    let sent: LlmMessage[] | undefined;
    const history = Array.from({ length: 24 }, (_, index): LlmMessage[] => [
        {
            role: "user",
            content: `old-${index} ${"a".repeat(500)}`,
            timestamp: index * 2 + 1
        },
        {
            ...assistantMessage(),
            timestamp: index * 2 + 2
        }
    ]).flat();
    const session = new Session(meta, history);

    await session.request("latest question", {
        llm: {
            getModel: () => MODEL,
            stream(request) {
                sent = [...request.messages];
                return (async function* (): AsyncIterable<LlmStreamEvent> {
                    yield { type: "done", message: assistantMessage() };
                })();
            }
        },
        config: SMALL_CONTEXT_CONFIG,
        emit: () => undefined
    });

    expect(sent?.[0]).toMatchObject({
        role: "system",
        context: "injected"
    });
    expect(sent).toHaveLength(history.length + 2);
    for (let index = 0; index < 24; index += 1) {
        expect(JSON.stringify(sent)).toContain(`old-${index} `);
    }
    expect(sent?.at(-1)).toMatchObject({
        role: "user",
        content: "latest question"
    });
    expect(JSON.stringify(sent)).not.toContain("Earlier conversation history was omitted");
});

test("compacts old context while preserving the unselected prefix and latest messages", async () => {
    const history = compactionHistory();
    const session = new Session(meta, history, NO_TOOLS);
    let compactionRequests = 0;
    let actualMessages: LlmMessage[] | undefined;

    await session.request("latest question", {
        llm: {
            getModel: () => COMPACTION_MODEL,
            stream(request) {
                if (request.systemPrompt === CONTEXT_COMPACTION_SYSTEM_PROMPT) {
                    compactionRequests += 1;
                    return (async function* (): AsyncIterable<LlmStreamEvent> {
                        yield {
                            type: "done",
                            message: assistantTextMessage(
                                "<compact>\ncondensed old context\n</compact>"
                            )
                        };
                    })();
                }
                actualMessages = [...request.messages];
                return (async function* (): AsyncIterable<LlmStreamEvent> {
                    yield { type: "done", message: assistantMessage() };
                })();
            }
        },
        config: COMPACTION_CONFIG,
        emit: () => undefined
    });

    const messages = session.snapshot().messages;
    const compactIndex = messages.findIndex(
        (message) => message.role === "user" && message.context === "compact"
    );
    const selectedPositions = history
        .map((message, index) => ({
            index,
            id: messageRecordId(message)
        }))
        .filter((entry): entry is { index: number; id: string } => (
            entry.id !== undefined
        ));
    const selectedIds = selectedPositions.map((entry) => entry.id);
    const selectionStart = selectedPositions[0]?.index ?? -1;
    const selectionEnd = (selectedPositions.at(-1)?.index ?? -1) + 1;
    expect(compactionRequests).toBe(1);
    expect(selectedPositions.length).toBeGreaterThan(0);
    expect(selectedPositions.every((entry, index) => (
        entry.index === selectionStart + index
    ))).toBe(true);
    expect(compactIndex).toBe(selectionStart);
    for (let index = 0; index < compactIndex; index += 1) {
        expect(messages[index]).toBe(history[index]);
    }
    expect(messages[compactIndex]).toMatchObject({
        role: "user",
        context: "compact",
        content: "<compact>\ncondensed old context\n</compact>"
    });
    const retained = messages.slice(compactIndex + 1, messages.length - 2);
    expect(retained).toHaveLength(history.length - selectionEnd);
    for (const [index, message] of retained.entries()) {
        expect(message).toBe(history[selectionEnd + index]);
    }
    expect(messages.at(-2)).toMatchObject({
        role: "user",
        content: "latest question"
    });
    expect(messages.at(-1)).toMatchObject({
        role: "assistant"
    });
    expect(actualMessages).toContainEqual(expect.objectContaining({
        context: "compact"
    }));
    const serializedRequest = JSON.stringify(actualMessages);
    for (const [index, message] of history.entries()) {
        if (message.role !== "user") {
            continue;
        }
        const oldIndex = index / 2;
        const selected = index >= selectionStart && index < selectionEnd;
        expect(
            serializedRequest.includes(`old-${oldIndex}-`),
            `old-${oldIndex}- selected=${selected}`
        ).toBe(!selected);
    }
    expect(persistCompaction).toHaveBeenCalledWith(
        meta.id,
        expect.objectContaining({
            context: "compact",
            content: expect.stringContaining("<compact>")
        }),
        expect.any(Array)
    );
    expect(persistCompaction.mock.calls[0]?.[2]).toEqual(selectedIds);
});

test("leaves history unchanged when compaction fails", async () => {
    const history = compactionHistory();
    const session = new Session(meta, history, NO_TOOLS);
    const events: JarvixEvent[] = [];
    let modelRequests = 0;

    await expect(session.request("latest question", {
        llm: {
            getModel: () => COMPACTION_MODEL,
            stream(request) {
                if (request.systemPrompt === CONTEXT_COMPACTION_SYSTEM_PROMPT) {
                    return (async function* (): AsyncIterable<LlmStreamEvent> {
                        yield {
                            type: "error",
                            message: {
                                ...assistantMessage(),
                                stopReason: "error",
                                errorMessage: "compact failed"
                            }
                        };
                    })();
                }
                modelRequests += 1;
                return (async function* (): AsyncIterable<LlmStreamEvent> {
                    yield { type: "done", message: assistantMessage() };
                })();
            }
        },
        config: COMPACTION_CONFIG,
        emit: (event) => events.push(event)
    })).rejects.toThrow("compact failed");

    const messages = session.snapshot().messages;
    expect(modelRequests).toBe(0);
    expect(persistCompaction).not.toHaveBeenCalled();
    expect(messages).toHaveLength(history.length + 1);
    for (const [index, message] of history.entries()) {
        expect(messages[index]).toBe(message);
    }
    expect(messages.at(-1)).toMatchObject({
        role: "user",
        content: "latest question"
    });
    expect(events).toContainEqual({
        type: "request.error",
        error: "compact failed"
    });
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

    expect(persist).toHaveBeenCalledTimes(4);
    expect(persist.mock.calls.map(([, message]) => message.role)).toEqual([
        "system",
        "system",
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
    persist.mockImplementation((_id, message) => {
        if (message.role === "user") {
            throw new Error("disk full");
        }
    });
    const session = new Session(meta);
    const runtime = {
        llm: fakeLlm(assistantMessage()),
        config: TEST_CONFIG,
        emit: () => undefined
    };

    await expect(session.request("first", runtime)).rejects.toThrow(/after 2 attempts/);
    expect(persist).toHaveBeenCalledTimes(3);
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
            if (event.type === "context.usage") {
                return;
            }
            timeline.push(`event:${event.type}`);
            events.push(event);
        }
    });

    expect(timeline).toEqual([
        "persist:system",
        "persist:user",
        "event:done",
        "persist:assistant"
    ]);
    expect(withoutContextUsage(events).map((event) => event.type)).toEqual(["done"]);
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
    expect(withoutContextUsage(events).map((event) => event.type)).toEqual(["done", "request.error"]);
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
            expect(withoutContextUsage(events)).toEqual([toolCall, completed]);
            expect(persist.mock.calls.map(([, message]) => message.role)).toEqual([
                "system",
                "user",
                "assistant"
            ]);
            yield nextCompleted;
            yield failed;
            expect(withoutContextUsage(events)).toEqual([toolCall, completed, nextCompleted, failed]);
            expect(session.snapshot().messages).toEqual([
                expect.objectContaining({ role: "user" }), completed.message, nextCompleted.message
            ]);
            expect(persist.mock.calls.map(([, message]) => message).filter(
                (message) => message.role !== "system"
                    || message.context !== "injected"
            )).toEqual(session.snapshot().messages);
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
    expect(withoutContextUsage(events)).toEqual([
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
        stop: async () => [],
        dispose: () => undefined
    };
    const events: JarvixEvent[] = [];
    const session = new Session(meta, [], tools);

    await session.request("run it", {
        llm,
        config: TEST_CONFIG,
        emit: (event) => { events.push(event); }
    });

    expect(withoutContextUsage(events).map((event) => event.type)).toEqual([
        "start",
        "done",
        "tool.start",
        "tool.output",
        "tool.end",
        "start",
        "done"
    ]);
    expect(withoutContextUsage(events)[3]).toEqual({
        type: "tool.output",
        toolCallId: "call-1",
        toolName: "exec_command",
        data: { kind: "shell.exec_command", output: "hi\n" }
    });
    expect(requests[1]?.map((message) => message.role)).toEqual([
        "system",
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

test("keeps the base tool list stable and sends loaded tools as deltas", async () => {
    const loadDefinition = {
        name: "load_tool",
        description: "Load a deferred tool",
        parameters: { type: "object", properties: {} }
    };
    const loadedDefinition = {
        name: "external_lookup",
        description: "Look up an external value",
        parameters: { type: "object", properties: {} }
    };
    let loaded = false;
    const requests: LlmRequest[] = [];
    const llm: LlmAdapter = {
        getModel: () => MODEL,
        stream(request) {
            requests.push({
                ...request,
                messages: [...request.messages],
                tools: request.tools ? [...request.tools] : undefined
            });
            const message: LlmAssistantMessage = requests.length === 1
                ? {
                    ...assistantMessage(),
                    content: [{
                            type: "toolCall",
                            id: "load-1",
                            name: "load_tool",
                            arguments: { name: "external_lookup" }
                        }],
                    stopReason: "toolUse" as const
                }
                : assistantMessage();
            return (async function* (): AsyncIterable<LlmStreamEvent> {
                yield { type: "done", message };
            })();
        }
    };
    const tools: ToolExecutor = {
        definitions: [loadDefinition, loadedDefinition],
        getRegisteredTools: () => loaded
            ? [loadDefinition, loadedDefinition]
            : [loadDefinition],
        handles: (name) => name === "load_tool" || name === "external_lookup",
        execute: async (call) => {
            loaded = true;
            return {
                content: "loaded",
                data: createGenericToolCallViewData(
                    call.name,
                    call.arguments,
                    "completed"
                ),
                isError: false,
                endReason: "exited"
            };
        },
        stop: async () => [],
        dispose: () => undefined
    };
    const session = new Session(meta, [], tools);

    await session.request("load the external tool", {
        llm,
        config: TEST_CONFIG,
        emit: () => undefined
    });

    expect(requests[0]?.tools).toEqual([loadDefinition]);
    expect(requests[1]?.tools).toEqual([loadDefinition]);
    expect(requests[1]?.messages.at(-1)).toMatchObject({
        role: "system",
        content: expect.stringContaining(
            "The available tools changed. Use only the current tool definitions."
        ),
        toolsAdded: [loadedDefinition]
    });
    expect(session.snapshot().messages.some((message) => (
        message.role === "system" && message.toolsAdded !== undefined
    ))).toBe(false);
});

test("injects MCP catalog changes on the next user message", async () => {
    let catalog = [mcpDefinition("mcp__first__lookup")];
    const base = {
        name: "exec_command",
        description: "Run a command",
        parameters: { type: "object", properties: {} }
    };
    const requests: LlmRequest[] = [];
    const llm: LlmAdapter = {
        getModel: () => MODEL,
        stream(request) {
            requests.push(request);
            return (async function* (): AsyncIterable<LlmStreamEvent> {
                yield { type: "done", message: assistantMessage() };
            })();
        }
    };
    const tools: ToolExecutor = {
        definitions: [base],
        getRegisteredTools: () => [base],
        getContextSnapshotTools: () => catalog,
        handles: () => true,
        execute: async () => ({
            content: "ok",
            data: createGenericToolCallViewData("exec_command", {}, "completed"),
            isError: false,
            endReason: "exited"
        }),
        stop: async () => [],
        dispose: () => undefined
    };
    const session = new Session(meta, [], tools);
    const runtime = {
        llm,
        config: TEST_CONFIG,
        workingDirectories: ["C:\\workspace"],
        emit: () => undefined
    };

    session.providerContext(runtime.workingDirectories);
    catalog = [mcpDefinition("mcp__second__lookup")];

    const inspected = session.providerContext(runtime.workingDirectories);
    expect(inspected.messages.some((message) => (
        message.role === "system"
        && message.content.includes(
            'MCP tool "mcp__second__lookup" was added.'
        )
    ))).toBe(false);

    await session.request("hello", runtime);

    const changes = (requests[0]?.messages ?? []).flatMap((message) => (
        message.role === "system"
        && message.context === "injected"
        && message.content.startsWith("MCP tool ")
            ? [message]
            : []
    ));
    expect(changes).toHaveLength(2);

    const added = changes.find((message) => (
        message.content.includes('MCP tool "mcp__second__lookup" was added.')
    ));
    expect(added?.content).toContain(
        "Description: MCP tool mcp__second__lookup"
    );
    expect(added?.content).not.toContain("mcp__first__lookup");
    expect(added).not.toMatchObject({
        toolsAdded: expect.anything()
    });

    const removed = changes.find((message) => (
        message.content.includes('MCP tool "mcp__first__lookup" was removed.')
    ));
    expect(removed?.content).not.toContain("mcp__second__lookup");
});

test("appends newly applicable AGENTS.md instructions without changing the prompt prefix", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvix-session-agents-"));
    const workspace = join(root, "workspace");
    const nested = join(workspace, "packages", "app");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(workspace, "AGENTS.md"), "project rules", "utf8");
    writeFileSync(join(nested, "AGENTS.md"), "app rules", "utf8");

    try {
        const toolCall = {
            type: "toolCall" as const,
            id: "call-agents",
            name: "exec_command",
            arguments: { command: "pwd", cwd: nested, timeoutMs: 1_000 }
        };
        const toolUseMessage: LlmAssistantMessage = {
            ...assistantMessage(),
            content: [toolCall],
            stopReason: "toolUse"
        };
        const requests: LlmMessage[][] = [];
        let response = 0;
        const llm: LlmAdapter = {
            getModel: () => MODEL,
            stream(request) {
                requests.push([...request.messages]);
                const message = response === 0
                    ? toolUseMessage
                    : assistantMessage();
                response += 1;
                return (async function* (): AsyncIterable<LlmStreamEvent> {
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
            execute: async () => ({
                content: "workspace",
                data: {
                    kind: "shell.exec_command",
                    command: "pwd",
                    output: "workspace",
                    status: "completed"
                },
                isError: false,
                endReason: "exited"
            }),
            stop: async () => [],
            dispose: () => undefined
        };
        const contextManagerFactory: ContextManagerFactory = (permission) => (
            new DefaultContextManager(
                permission,
                SYSTEM_PROMPT,
                new AgentInstructions({ homeDirectory: join(root, "home") })
            )
        );
        const session = new Session(
            meta,
            [],
            tools,
            undefined,
            contextManagerFactory
        );

        await session.request("inspect the package", {
            llm,
            config: TEST_CONFIG,
            workingDirectories: [workspace],
            emit: () => undefined
        });

        const environment = requests[0]?.[0];
        expect(environment).toMatchObject({
            role: "system",
            context: "injected"
        });
        expect(requests[0]?.[1]).toMatchObject({
            role: "system",
            context: "injected",
            content: expect.stringContaining("project rules")
        });
        expect(requests[1]?.[0]).toBe(environment);
        expect(requests[1]?.at(-1)).toMatchObject({
            role: "system",
            context: "injected",
            content: expect.stringContaining("app rules")
        });
        expect(session.snapshot().messages.some((message) => (
            message.role === "system" && message.context === "injected"
        ))).toBe(false);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("injects AGENTS.md content changes on the next user message", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvix-session-agents-change-"));
    const workspace = join(root, "workspace");
    const agentsPath = join(workspace, "AGENTS.md");
    mkdirSync(workspace, { recursive: true });
    writeFileSync(agentsPath, "original rules", "utf8");

    try {
        const requests: LlmRequest[] = [];
        const llm: LlmAdapter = {
            getModel: () => MODEL,
            stream(request) {
                requests.push(request);
                return (async function* (): AsyncIterable<LlmStreamEvent> {
                    yield { type: "done", message: assistantMessage() };
                })();
            }
        };
        const contextManagerFactory: ContextManagerFactory = (permission) => (
            new DefaultContextManager(
                permission,
                SYSTEM_PROMPT,
                new AgentInstructions({ homeDirectory: join(root, "home") })
            )
        );
        const session = new Session(
            meta,
            [],
            NO_TOOLS,
            undefined,
            contextManagerFactory
        );
        const runtime = {
            llm,
            config: TEST_CONFIG,
            workingDirectories: [workspace],
            emit: () => undefined
        };

        await session.request("first", runtime);
        writeFileSync(agentsPath, "updated rules", "utf8");
        await session.request("second", runtime);

        expect(requests[1]?.messages.at(-2)).toMatchObject({
            role: "system",
            context: "injected",
            content: expect.stringContaining(
                "AGENTS.md instructions changed."
            )
        });
        expect(requests[1]?.messages.at(-2)).toMatchObject({
            content: expect.stringContaining("updated rules")
        });
        expect(requests[1]?.messages.at(-2)).not.toMatchObject({
            content: expect.stringContaining("original rules")
        });
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("injects prompts after the active LLM request and before the next round", async () => {
    const requests: LlmMessage[][] = [];
    const events: JarvixEvent[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    let call = 0;
    const llm: LlmAdapter = {
        getModel: () => MODEL,
        stream(request) {
            requests.push([...request.messages]);
            const current = call;
            call += 1;
            return (async function* (): AsyncIterable<LlmStreamEvent> {
                yield { type: "start" };
                if (current === 0) {
                    await gate;
                }
                yield {
                    type: "done",
                    message: {
                        ...assistantMessage(),
                        content: [{ type: "text", text: current === 0 ? "first reply" : "second reply" }]
                    }
                };
            })();
        }
    };
    const session = new Session(meta);

    const request = session.request("first", {
        llm,
        config: TEST_CONFIG,
        emit: (event) => {
            events.push(event);
        }
    });

    await vi.waitFor(() => {
        expect(requests).toHaveLength(1);
    });
    expect(session.injectPrompt("follow up one", "prompt-1")).toBe(true);
    expect(session.injectPrompt("follow up two", "prompt-2")).toBe(true);
    expect(session.snapshot().messages.map((message) => message.role)).toEqual(["user"]);

    release();
    await request;

    expect(requests).toHaveLength(2);
    expect(requests[1]?.map((message) => message.role)).toEqual([
        "system",
        "user",
        "assistant",
        "user",
        "user"
    ]);
    expect(requests[1]?.slice(-2).map((message) => (
        message.role === "user" ? message.content : ""
    ))).toEqual(["follow up one", "follow up two"]);
    expect(session.snapshot().messages.map((message) => message.role)).toEqual([
        "user",
        "assistant",
        "user",
        "user",
        "assistant"
    ]);
    expect(events.filter((event) => event.type === "prompt.injected")).toEqual([
        { type: "prompt.injected", promptId: "prompt-1", text: "follow up one" },
        { type: "prompt.injected", promptId: "prompt-2", text: "follow up two" }
    ]);
});

test("injects prompts after tool execution before the next LLM request", async () => {
    const toolCall = {
        type: "toolCall" as const,
        id: "call-inject",
        name: "exec_command",
        arguments: { command: "echo hi", cwd: process.cwd(), timeoutMs: 1000 }
    };
    const toolUseMessage: LlmAssistantMessage = {
        ...assistantMessage(),
        content: [toolCall],
        stopReason: "toolUse"
    };
    const requests: LlmMessage[][] = [];
    const events: JarvixEvent[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    let call = 0;
    const llm: LlmAdapter = {
        getModel: () => MODEL,
        stream(request) {
            requests.push([...request.messages]);
            const message = call === 0 ? toolUseMessage : assistantMessage();
            call += 1;
            return (async function* (): AsyncIterable<LlmStreamEvent> {
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
        execute: async () => {
            await gate;
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
        stop: async () => [],
        dispose: () => undefined
    };
    const session = new Session(meta, [], tools);

    const request = session.request("first", {
        llm,
        config: TEST_CONFIG,
        emit: (event) => {
            events.push(event);
        }
    });

    await vi.waitFor(() => {
        expect(events.some((event) => event.type === "tool.start")).toBe(true);
    });
    expect(session.injectPrompt("after tools", "prompt-tools")).toBe(true);
    expect(session.snapshot().messages.map((message) => message.role)).toEqual([
        "user",
        "assistant"
    ]);

    release();
    await request;

    expect(requests[1]?.map((message) => message.role)).toEqual([
        "system",
        "user",
        "assistant",
        "toolResult",
        "user"
    ]);
    expect(requests[1]?.at(-1)).toMatchObject({
        role: "user",
        content: "after tools"
    });
    const toolEnd = events.findIndex((event) => event.type === "tool.end");
    const injected = events.findIndex((event) => event.type === "prompt.injected");
    expect(toolEnd).toBeGreaterThan(-1);
    expect(injected).toBeGreaterThan(toolEnd);
});

test("injects permission notices after tool results before the next LLM request", async () => {
    const toolCall = {
        type: "toolCall" as const,
        id: "call-permission",
        name: "exec_command",
        arguments: { command: "echo hi", cwd: process.cwd(), timeoutMs: 1000 }
    };
    const toolUseMessage: LlmAssistantMessage = {
        ...assistantMessage(),
        content: [toolCall],
        stopReason: "toolUse"
    };
    const requests: LlmMessage[][] = [];
    const events: JarvixEvent[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    let call = 0;
    const llm: LlmAdapter = {
        getModel: () => MODEL,
        stream(request) {
            requests.push([...request.messages]);
            const message = call === 0 ? toolUseMessage : assistantMessage();
            call += 1;
            return (async function* (): AsyncIterable<LlmStreamEvent> {
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
        execute: async () => {
            await gate;
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
        stop: async () => [],
        dispose: () => undefined
    };
    const session = new Session({ ...meta, permission: "read-only" }, [], tools);

    const request = session.request("first", {
        llm,
        config: TEST_CONFIG,
        emit: (event) => {
            events.push(event);
        }
    });

    await vi.waitFor(() => {
        expect(events.some((event) => event.type === "tool.start")).toBe(true);
    });
    session.applyPermission("full-access");
    expect(session.injectPrompt("after permission", "prompt-after-permission")).toBe(true);
    expect(session.snapshot().messages.map((message) => message.role)).toEqual([
        "user",
        "assistant"
    ]);

    release();
    await request;

    expect(requests[1]?.map((message) => message.role)).toEqual([
        "system",
        "user",
        "assistant",
        "toolResult",
        "system",
        "user"
    ]);
    expect(requests[1]?.[4]).toMatchObject({
        role: "system",
        context: "injected",
        content: expect.stringContaining("permission: full-access")
    });
    expect(requests[1]?.[5]).toMatchObject({
        role: "user",
        content: "after permission"
    });
    const toolEnd = events.findIndex((event) => event.type === "tool.end");
    const injected = events.findIndex((event) => event.type === "prompt.injected");
    expect(toolEnd).toBeGreaterThan(-1);
    expect(injected).toBeGreaterThan(toolEnd);
});

test("does not inject permission changes until the next user message", async () => {
    const events: JarvixEvent[] = [];
    const requests: LlmRequest[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const stream = vi.fn((request: LlmRequest) => (async function* (): AsyncIterable<LlmStreamEvent> {
        requests.push(request);
        yield { type: "start" };
        await gate;
        yield { type: "done", message: assistantMessage() };
    })());
    const session = new Session({ ...meta, permission: "read-only" });

    const request = session.request("first", {
        llm: { getModel: () => MODEL, stream },
        config: TEST_CONFIG,
        emit: (event) => {
            events.push(event);
        }
    });

    await vi.waitFor(() => {
        expect(events.some((event) => event.type === "start")).toBe(true);
    });
    session.applyPermission("full-access");
    release();
    await request;

    expect(stream).toHaveBeenCalledTimes(1);
    expect(session.snapshot().messages.map((message) => message.role)).toEqual([
        "user",
        "assistant"
    ]);
    expect(events.some((event) => event.type === "system.message")).toBe(false);
    expect(session.providerContext().messages.some((message) => (
        message.role === "system"
        && message.content.includes("permission: full-access")
    ))).toBe(false);

    await session.request("next", {
        llm: { getModel: () => MODEL, stream },
        config: TEST_CONFIG,
        emit: () => undefined
    });

    expect(requests[1]?.messages.at(-2)).toMatchObject({
        role: "system",
        context: "injected",
        content: expect.stringContaining("permission: full-access")
    });
});

test("resets the round limit after injecting a prompt", async () => {
    let session!: Session;
    let toolRuns = 0;
    const tools: ToolExecutor = {
        definitions: [{
            name: "exec_command",
            description: "Run a command",
            parameters: { type: "object", properties: {} }
        }],
        handles: (name) => name === "exec_command",
        execute: async () => {
            toolRuns += 1;
            if (toolRuns === MAX_TOOL_ROUNDS) {
                expect(session.injectPrompt("fresh prompt", "fresh-prompt")).toBe(true);
            }
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
        stop: async () => [],
        dispose: () => undefined
    };
    let llmCalls = 0;
    const llm: LlmAdapter = {
        getModel: () => MODEL,
        stream(request) {
            llmCalls += 1;
            const last = request.messages.findLast((message) =>
                message.role !== "system"
                || !message.content.startsWith("<environment_context>")
            );
            const injected = last?.role === "user" && last.content === "fresh prompt";
            const message: LlmAssistantMessage = injected
                ? assistantMessage()
                : {
                    ...assistantMessage(),
                    content: [{
                        type: "toolCall",
                        id: `call-${llmCalls}`,
                        name: "exec_command",
                        arguments: { command: "echo hi", cwd: process.cwd(), timeoutMs: 1000 }
                    }],
                    stopReason: "toolUse"
                };
            return (async function* (): AsyncIterable<LlmStreamEvent> {
                yield { type: "done", message };
            })();
        }
    };
    session = new Session(meta, [], tools);

    await session.request("first", {
        llm,
        config: TEST_CONFIG,
        emit: () => undefined
    });

    expect(toolRuns).toBe(MAX_TOOL_ROUNDS);
    expect(llmCalls).toBe(MAX_TOOL_ROUNDS + 1);
    expect(session.snapshot().messages.at(-2)).toMatchObject({
        role: "user",
        content: "fresh prompt"
    });
    expect(session.snapshot().messages.at(-1)).toMatchObject({ role: "assistant" });
});

test("stops accepting stream events after an abort", async () => {
    let release!: () => void;
    let requestSignal: AbortSignal | undefined;
    const events: JarvixEvent[] = [];
    const llm: LlmAdapter = {
        getModel: () => MODEL,
        stream(request) {
            requestSignal = request.signal;
            return (async function* (): AsyncIterable<LlmStreamEvent> {
                yield { type: "start" };
                yield { type: "thinking.start", index: 0 };
                yield { type: "thinking.delta", index: 0, delta: "plan" };
                yield { type: "text.start", index: 1 };
                yield { type: "text.delta", index: 1, delta: "partial" };
                await new Promise<void>((resolvePromise) => {
                    release = resolvePromise;
                });
                yield { type: "done", message: assistantMessage() };
            })();
        }
    };
    const session = new Session(meta);

    const request = session.request("hello", {
        llm,
        config: TEST_CONFIG,
        emit: (event) => {
            events.push(event);
        }
    });

    await vi.waitFor(() => {
        expect(withoutContextUsage(events)).toHaveLength(5);
    });
    expect(session.injectPrompt("should not run", "prompt-aborted")).toBe(true);
    session.abort();
    release();
    await request;

    expect(requestSignal?.aborted).toBe(true);
    expect(withoutContextUsage(events).map((event) => event.type)).toEqual([
        "start",
        "thinking.start",
        "thinking.delta",
        "text.start",
        "text.delta"
    ]);
    expect(events.some((event) => event.type === "request.error")).toBe(false);
    expect(events.some((event) => event.type === "prompt.injected")).toBe(false);
    expect(session.snapshot().messages.map((message) => message.role)).toEqual(["user"]);
});

test("accepts an in-flight tool result but does not start another round after abort", async () => {
    const toolCall = {
        type: "toolCall" as const,
        id: "call-abort",
        name: "exec_command",
        arguments: { command: "echo hi", cwd: process.cwd(), timeoutMs: 10_000 }
    };
    const toolUseMessage: LlmAssistantMessage = {
        ...assistantMessage(),
        content: [toolCall],
        stopReason: "toolUse"
    };
    let release!: () => void;
    const stream = vi.fn(() => (async function* (): AsyncIterable<LlmStreamEvent> {
        yield { type: "done", message: toolUseMessage };
    })());
    const tools: ToolExecutor = {
        definitions: [{
            name: "exec_command",
            description: "Run a command",
            parameters: { type: "object", properties: {} }
        }],
        handles: (name) => name === "exec_command",
        execute: async (_call, observer) => {
            observer.onOutput({ kind: "shell.exec_command", output: "partial\n" });
            await new Promise<void>((resolvePromise) => {
                release = resolvePromise;
            });
            return {
                content: "Command aborted.",
                data: {
                    kind: "shell.exec_command",
                    command: "echo hi",
                    output: "partial\n",
                    status: "failed"
                },
                isError: true,
                endReason: "exited"
            };
        },
        stop: async () => [],
        dispose: () => undefined
    };
    const events: JarvixEvent[] = [];
    const session = new Session(meta, [], tools);

    const request = session.request("run it", {
        llm: { getModel: () => MODEL, stream },
        config: TEST_CONFIG,
        emit: (event) => {
            events.push(event);
        }
    });

    await vi.waitFor(() => {
        expect(events.some((event) => event.type === "tool.output")).toBe(true);
    });
    session.abort();
    release();
    await request;

    expect(stream).toHaveBeenCalledTimes(1);
    expect(withoutContextUsage(events).map((event) => event.type)).toEqual([
        "done",
        "tool.start",
        "tool.output",
        "tool.end"
    ]);
    expect(session.snapshot().messages.at(-1)).toMatchObject({
        role: "toolResult",
        toolCallId: "call-abort",
        content: "Command aborted."
    });
});

test("resets request state when run finalization throws", async () => {
    let failFinalization = true;
    const observer = {
        ...noopAgentObserver,
        runFinished: () => {
            if (failFinalization) {
                failFinalization = false;
                throw new Error("observer finalization failed");
            }
        }
    };
    const session = new Session(
        meta,
        [],
        NO_TOOLS,
        undefined,
        undefined,
        undefined,
        observer
    );

    await expect(session.request("first", {
        llm: fakeLlm(assistantMessage()),
        config: TEST_CONFIG,
        emit: () => undefined
    })).rejects.toThrow("observer finalization failed");

    await expect(session.request("second", {
        llm: fakeLlm(assistantMessage()),
        config: TEST_CONFIG,
        emit: () => undefined
    })).resolves.toBeUndefined();
});

test("shutdown waits for the request and emits events returned by tool stop", async () => {
    const toolCall = {
        type: "toolCall" as const,
        id: "call-shutdown",
        name: "exec_command",
        arguments: { command: "echo hi", cwd: process.cwd(), timeoutMs: 10_000 }
    };
    const toolUseMessage: LlmAssistantMessage = {
        ...assistantMessage(),
        content: [toolCall],
        stopReason: "toolUse"
    };
    const stream = vi.fn(() => (async function* (): AsyncIterable<LlmStreamEvent> {
        yield { type: "done", message: toolUseMessage };
    })());
    let stopCalled = false;
    const tools: ToolExecutor = {
        definitions: [{
            name: "exec_command",
            description: "Run a command",
            parameters: { type: "object", properties: {} }
        }],
        handles: (name) => name === "exec_command",
        execute: async (_call, _observer, signal) => new Promise((resolvePromise) => {
            signal?.addEventListener("abort", () => resolvePromise({
                content: "Command aborted.",
                data: {
                    kind: "shell.exec_command",
                    command: "echo hi",
                    output: "",
                    status: "failed"
                },
                isError: true,
                endReason: "exited"
            }), { once: true });
        }),
        stop: async () => {
            stopCalled = true;
            return [{
                type: "tool.end",
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                data: {
                    kind: "shell.exec_command",
                    command: "echo hi",
                    output: "partial\n",
                    status: "completed"
                },
                isError: false,
                endReason: "terminated"
            }];
        },
        dispose: () => undefined
    };
    const events: JarvixEvent[] = [];
    const session = new Session(meta, [], tools);
    const request = session.request("run it", {
        llm: { getModel: () => MODEL, stream },
        config: TEST_CONFIG,
        emit: (event) => {
            events.push(event);
        }
    });

    await vi.waitFor(() => {
        expect(events.some((event) => event.type === "tool.start")).toBe(true);
    });
    await session.shutdown();
    await request;

    expect(stopCalled).toBe(true);
    expect(events.at(-1)).toMatchObject({
        type: "tool.end",
        toolCallId: toolCall.id,
        endReason: "terminated",
        data: { status: "completed" }
    });
});

test("shutdown resolves when tool cleanup never settles", async () => {
    const dispose = vi.fn();
    const tools: ToolExecutor = {
        definitions: [],
        handles: () => false,
        execute: async () => {
            throw new Error("No tools are available");
        },
        stop: () => new Promise(() => undefined),
        dispose
    };
    const session = new Session(meta, [], tools);
    const startedAt = Date.now();

    await session.shutdown(20);

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(dispose).toHaveBeenCalled();
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
                    ? /sessionId: ([0-9a-f-]+)/.exec(
                        toolResultContentText(result.content)
                    )?.[1]
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

test("keeps background task events and exit notices after stopping the request", async () => {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-session-task-stop-"));
    const script = join(directory, "task.mjs");
    writeFileSync(script, [
        "process.stdout.write('start\\n');",
        "setTimeout(() => process.stdout.write('later\\n', () => process.exit(0)), 400);"
    ].join("\n"), "utf8");
    const command = process.platform === "win32"
        ? `& ${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`
        : `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`;
    const toolCall = {
        type: "toolCall" as const,
        id: "call-background-stop",
        name: "exec_command",
        arguments: { command, cwd: directory, timeoutMs: 50 }
    };
    let response = 0;
    const llm: LlmAdapter = {
        getModel: () => MODEL,
        stream(request) {
            if (response++ === 0) {
                return (async function* (): AsyncIterable<LlmStreamEvent> {
                    yield {
                        type: "done",
                        message: {
                            ...assistantMessage(),
                            content: [toolCall],
                            stopReason: "toolUse"
                        }
                    };
                })();
            }
            return (async function* (): AsyncIterable<LlmStreamEvent> {
                await new Promise<void>((resolvePromise) => {
                    if (request.signal?.aborted) {
                        resolvePromise();
                        return;
                    }
                    request.signal?.addEventListener("abort", () => resolvePromise(), {
                        once: true
                    });
                });
            })();
        }
    };
    const events: JarvixEvent[] = [];
    const session = new Session(meta, [], new BackgroundTaskManager());

    try {
        const pending = session.request("start a background task", {
            llm,
            config: TEST_CONFIG,
            emit: (event) => { events.push(event); }
        });
        await vi.waitFor(() => {
            expect(events).toContainEqual(expect.objectContaining({
                type: "backgroundTask.start"
            }));
        }, { timeout: 5_000 });
        const taskId = events.find(
            (event) => event.type === "backgroundTask.start"
        )?.task.id;
        expect(taskId).toBeTruthy();

        session.abort();
        await pending;

        await vi.waitFor(() => {
            expect(events).toContainEqual(expect.objectContaining({
                type: "backgroundTask.output",
                taskId,
                output: expect.stringContaining("later")
            }));
            expect(events).toContainEqual(expect.objectContaining({
                type: "backgroundTask.end",
                task: expect.objectContaining({
                    id: taskId,
                    status: "completed"
                })
            }));
            expect(events).toContainEqual(expect.objectContaining({
                type: "system.message",
                message: expect.objectContaining({
                    notice: expect.objectContaining({
                        kind: "background.task_exit",
                        sessionId: taskId
                    })
                })
            }));
        }, { timeout: 5_000 });
    } finally {
        session.dispose();
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
        rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});

test("refuses release while tools are active or a permission request is pending", () => {
    let activeWork = true;
    const dispose = vi.fn();
    const tools: ToolExecutor = {
        definitions: [],
        handles: () => false,
        hasActiveWork: () => activeWork,
        execute: async () => {
            throw new Error("No tools are available");
        },
        stop: async () => [],
        dispose
    };
    const permissions = new SessionPermissions();
    const session = new Session(meta, [], tools, permissions);

    expect(session.canRelease()).toBe(false);
    expect(session.release()).toBe(false);
    expect(dispose).not.toHaveBeenCalled();

    activeWork = false;
    const pending = permissions.begin({
        domains: [{ action: "enable", domain: "api.example.com" }],
        directories: []
    });

    expect(session.canRelease()).toBe(false);
    expect(session.release()).toBe(false);
    expect(dispose).not.toHaveBeenCalled();

    permissions.respond(pending.request.id, "cancelled");

    expect(session.release()).toBe(true);
    expect(dispose).toHaveBeenCalledTimes(1);
});

test("releases idle grants so the manager can retain their permission state", () => {
    const dispose = vi.fn();
    const tools: ToolExecutor = {
        definitions: [],
        handles: () => false,
        hasActiveWork: () => false,
        execute: async () => {
            throw new Error("No tools are available");
        },
        stop: async () => [],
        dispose
    };
    const permissions = new SessionPermissions();
    const session = new Session(meta, [], tools, permissions);
    const approved = permissions.begin({
        domains: [{ action: "enable", domain: "api.example.com" }],
        directories: []
    });
    permissions.respond(approved.request.id, "approved");

    expect(session.release()).toBe(true);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(permissions.canRelease()).toBe(false);

    permissions.reset();
});

test("refuses release while a message is waiting for persistence", async () => {
    persist.mockImplementation(() => {
        throw new Error("disk full");
    });
    const session = new Session(meta);

    await expect(session.request("keep this queued", {
        llm: fakeLlm(assistantMessage()),
        config: TEST_CONFIG,
        emit: () => undefined
    })).rejects.toThrow("after 2 attempts");

    expect(session.canRelease()).toBe(false);
    expect(session.release()).toBe(false);
});

function fakeLlm(message: LlmAssistantMessage): LlmAdapter {
    return streamLlm((async function* (): AsyncIterable<LlmStreamEvent> {
        yield { type: "done", message };
    })());
}

function compactionHistory(pairs = 15): LlmMessage[] {
    return Array.from({ length: pairs }, (_, index): LlmMessage[] => [
        {
            role: "user",
            content: `old-${index}-${"u".repeat(3_500)}`,
            timestamp: index * 2 + 1
        },
        {
            ...assistantTextMessage(`reply-${index}-${"a".repeat(3_500)}`),
            timestamp: index * 2 + 2
        }
    ]).flat();
}

function withoutContextUsage(events: readonly JarvixEvent[]): JarvixEvent[] {
    return events.filter((event) => event.type !== "context.usage");
}

function streamLlm(events: AsyncIterable<LlmStreamEvent>): LlmAdapter {
    return {
        getModel: () => MODEL,
        stream(): AsyncIterable<LlmStreamEvent> {
            return events;
        }
    };
}

function mcpDefinition(name: string) {
    return {
        name,
        description: `MCP tool ${name}`,
        parameters: {
            type: "object",
            properties: {}
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

function assistantTextMessage(text: string): LlmAssistantMessage {
    return {
        ...assistantMessage(),
        content: [{ type: "text", text }]
    };
}
