import { beforeEach, expect, test, vi } from "vitest";
import type { LlmAdapter } from "../llm/index.ts";
import type {
    LlmAssistantMessage,
    LlmModelInfo,
    LlmStreamEvent
} from "../llm/types.ts";
import type { JarvixEvent } from "../protocol/event.ts";
import type { JarvixSessionMeta } from "../protocol/session.ts";
import { Session } from "./session.ts";
import { appendSessionMessage } from "./store.ts";

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

beforeEach(() => {
    persist.mockReset();
});

test("retries persistence once and dequeues the message on success", async () => {
    persist.mockImplementationOnce(() => {
        throw new Error("disk full");
    });
    const session = new Session(meta);

    await session.request("first", {
        llm: fakeLlm(assistantMessage()),
        config: {},
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
        config: {},
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
        config: {},
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
        config: {},
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
        config: {},
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
        config: {},
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
        config: {},
        emit: (event) => { events.push(event); }
    })).rejects.toThrow("stream failed");

    expect(session.snapshot().messages.at(-1)).toBe(message);
    expect(persist).toHaveBeenLastCalledWith(meta.id, message);
    expect(events).toEqual([
        { type: "done", message },
        { type: "request.error", error: "stream failed" }
    ]);
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
