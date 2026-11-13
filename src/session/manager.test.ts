import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test, vi } from "vitest";
import type { LlmAdapter } from "../llm/index.ts";
import type { LlmAssistantMessage, LlmModelInfo, LlmStreamEvent } from "../llm/types.ts";
import { SessionManager } from "./manager.ts";

const home = vi.hoisted(() => ({ path: "" }));

vi.mock("node:os", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:os")>();
    return { ...actual, homedir: () => home.path };
});

const base = mkdtempSync(join(tmpdir(), "jarvix-session-manager-"));
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

test("creates and tracks independent sessions", () => {
    home.path = join(base, "create-home");
    const manager = new SessionManager();

    const first = manager.create("First session");
    const second = manager.create("Second session");

    expect(first.meta.id).not.toBe(second.meta.id);
    expect(first.meta.name).toBe("First session");
    expect(second.meta.name).toBe("Second session");
    expect(manager.load(first.meta.id)).toBe(first);
    expect(manager.load(second.meta.id)).toBe(second);
    expect(manager.listSummaries()).toHaveLength(2);
});

test("persists session messages and caches loaded sessions", async () => {
    home.path = join(base, "load-home");
    const manager = new SessionManager();
    const session = manager.create("Untitled session");

    await session.request("hello", {
        llm: fakeLlm(),
        config: {},
        emit: () => undefined
    });

    expect(manager.load(session.meta.id)).toBe(session);

    const reloaded = new SessionManager();
    const loaded = reloaded.load(session.meta.id);
    expect(loaded?.snapshot().meta).toEqual(session.meta);
    expect(loaded?.snapshot().messages).toHaveLength(2);
    expect(loaded?.snapshot().messages.map((message) => message.role)).toEqual([
        "user",
        "assistant"
    ]);
    expect(loaded?.snapshot().messages[0]).toMatchObject({
        role: "user",
        content: "hello"
    });
    expect(reloaded.load(session.meta.id)).toBe(loaded);
});

function fakeLlm(): LlmAdapter {
    const message: LlmAssistantMessage = {
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
        timestamp: Date.now()
    };

    return {
        getModel: () => MODEL,
        stream(): AsyncIterable<LlmStreamEvent> {
            return (async function* (): AsyncIterable<LlmStreamEvent> {
                yield { type: "done", message };
            })();
        }
    };
}
