import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test, vi } from "vitest";
import type { LlmAdapter, LlmAssistantMessage, LlmMessage, LlmModelInfo, LlmStreamEvent } from "../llm/index.ts";
import { loadSession } from "../session/store.ts";
import { Jarvix } from "./index.ts";

const home = vi.hoisted(() => ({ path: "" }));

vi.mock("node:os", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:os")>();
    return { ...actual, homedir: () => home.path };
});

const base = mkdtempSync(join(tmpdir(), "jarvix-core-session-"));

const MODEL: LlmModelInfo = {
    provider: "test",
    id: "test-model",
    name: "Test",
    reasoning: false,
    contextWindow: 1000,
    maxTokens: 100
};

afterAll(() => {
    rmSync(base, { recursive: true, force: true });
});

function assistantMessage(text: string): LlmAssistantMessage {
    return {
        role: "assistant",
        content: [{ type: "text", text }],
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
        timestamp: Date.now()
    };
}

function fakeLlm(reply: string, seen: LlmMessage[][]): LlmAdapter {
    return {
        getModel: () => MODEL,
        stream(request) {
            seen.push([...request.messages]);
            const message = assistantMessage(reply);
            return (async function* (): AsyncIterable<LlmStreamEvent> {
                yield { type: "start" };
                yield { type: "text.start", index: 0 };
                yield { type: "text.delta", index: 0, delta: reply };
                yield { type: "text.end", index: 0, text: reply };
                yield { type: "done", message };
            })();
        }
    };
}

function gatedLlm(seen: LlmMessage[][], gate: Promise<void>): LlmAdapter {
    return {
        getModel: () => MODEL,
        stream(request) {
            seen.push([...request.messages]);
            const question = request.messages[0];
            const reply = question?.role === "user" ? `reply:${question.content}` : "reply";
            const message = assistantMessage(reply);
            return (async function* (): AsyncIterable<LlmStreamEvent> {
                yield { type: "start" };
                await gate;
                yield { type: "text.start", index: 0 };
                yield { type: "text.delta", index: 0, delta: reply };
                yield { type: "text.end", index: 0, text: reply };
                yield { type: "done", message };
            })();
        }
    };
}

test("persists each turn and resumes the stored history for the next request", async () => {
    home.path = join(base, "resume-home");
    const directory = join(home.path, ".jarvix", "sessions");
    const requests: LlmMessage[][] = [];

    const first = new Jarvix({ llm: fakeLlm("first reply", requests) });
    const firstSession = first.createSession();
    await first.request("first question", firstSession.meta.id);

    const stored = loadSession(firstSession.meta.id, directory);
    if (!stored) {
        throw new Error("Expected the first session to be persisted");
    }
    expect(stored?.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(stored?.messages[0]).toMatchObject({ role: "user", content: "first question" });

    const second = new Jarvix({ llm: fakeLlm("second reply", requests) });
    expect(second.loadSession(stored.meta.id)?.messages).toHaveLength(2);
    await second.request("second question", stored.meta.id);

    expect(requests[1]?.map((message) => message.role)).toEqual(["user", "assistant", "user"]);

    const reloaded = loadSession(stored.meta.id, directory);
    expect(reloaded?.messages.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant"]);
});

test("creates a session explicitly and persists messages", async () => {
    home.path = join(base, "lazy-home");
    const directory = join(home.path, ".jarvix", "sessions");
    const jarvix = new Jarvix({ llm: fakeLlm("ok", []) });

    expect(jarvix.listSessions()).toEqual([]);

    const created = jarvix.createSession();
    await jarvix.request("hello", created.meta.id);

    const session = jarvix.loadSession(created.meta.id);
    expect(session?.messages).toHaveLength(2);
    expect(loadSession(session?.meta.id ?? "", directory)?.messages).toHaveLength(2);
});

test("runs separate sessions in parallel with isolated histories", async () => {
    home.path = join(base, "parallel-home");
    const directory = join(home.path, ".jarvix", "sessions");
    const requests: LlmMessage[][] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const jarvix = new Jarvix({ llm: gatedLlm(requests, gate) });
    const first = jarvix.createSession();
    const second = jarvix.createSession();
    expect(jarvix.listSessions()).toHaveLength(2);
    const eventSessions = new Set<string>();
    jarvix.subscribe((_event, sessionId) => {
        eventSessions.add(sessionId);
    });

    const firstRequest = jarvix.request("first", first.meta.id);
    const secondRequest = jarvix.request("second", second.meta.id);

    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests.map((messages) => messages[0]?.content).sort()).toEqual(["first", "second"]);
    expect(jarvix.loadSession(first.meta.id)?.messages).toHaveLength(1);
    expect(jarvix.loadSession(second.meta.id)?.messages).toHaveLength(1);

    release();
    await Promise.all([firstRequest, secondRequest]);

    const firstSession = jarvix.loadSession(first.meta.id);
    const secondSession = jarvix.loadSession(second.meta.id);
    expect(firstSession?.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(secondSession?.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(firstSession?.messages[0]).toMatchObject({ role: "user", content: "first" });
    expect(secondSession?.messages[0]).toMatchObject({ role: "user", content: "second" });
    expect([...eventSessions].sort()).toEqual([first.meta.id, second.meta.id].sort());
    expect(loadSession(first.meta.id, directory)?.messages).toHaveLength(2);
    expect(loadSession(second.meta.id, directory)?.messages).toHaveLength(2);
    const summaries = jarvix.listSessions();
    expect(summaries.map((session) => session.title).sort()).toEqual(["first", "second"]);
    expect(summaries.map((session) => session.messageCount)).toEqual([2, 2]);
});

test("rejects a second request in the same session", async () => {
    home.path = join(base, "busy-home");
    const requests: LlmMessage[][] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const jarvix = new Jarvix({ llm: gatedLlm(requests, gate) });
    const session = jarvix.createSession();

    const firstRequest = jarvix.request("first", session.meta.id);
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    await expect(jarvix.request("second", session.meta.id))
        .rejects.toThrow(`Session is busy: ${session.meta.id}`);

    release();
    await firstRequest;
    expect(jarvix.loadSession(session.meta.id)?.messages).toHaveLength(2);
});
