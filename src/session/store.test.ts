import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import type { LlmAssistantMessage, LlmUserMessage } from "../llm/types.ts";
import {
    SESSION_FORMAT_VERSION,
    appendSessionMessage,
    createSession,
    listSessionSummaries,
    loadSession,
    sessionFile
} from "./store.ts";

const base = mkdtempSync(join(tmpdir(), "jarvix-session-"));

const userMessage: LlmUserMessage = {
    role: "user",
    content: "hello",
    timestamp: 1_700_000_000_000
};

const assistantMessage: LlmAssistantMessage = {
    role: "assistant",
    content: [
        { type: "thinking", thinking: "thinking about it", signature: "sig-thinking" },
        { type: "text", text: "hi there", signature: "sig-text" },
        { type: "toolCall", id: "call-1", name: "lookup", arguments: { query: "jarvix" } }
    ],
    provider: "deepseek",
    model: "deepseek-flash",
    api: "openai-completions",
    usage: {
        inputTokens: 12,
        outputTokens: 34,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 5,
        totalTokens: 46,
        cost: 0.001
    },
    stopReason: "stop",
    timestamp: 1_700_000_001_000,
    responseId: "response-1",
    responseModel: "deepseek-flash"
};

afterAll(() => {
    rmSync(base, { recursive: true, force: true });
});

test("sessionFile places <id>.jsonl in the given directory", () => {
    expect(sessionFile("abc", base)).toBe(join(base, "abc.jsonl"));
});

test("createSession writes a v1 header to a <uuid>.jsonl file", () => {
    const directory = join(base, "create");
    const session = createSession(directory);

    expect(session.messages).toEqual([]);
    expect(session.meta.type).toBe("session");
    expect(session.meta.version).toBe(SESSION_FORMAT_VERSION);
    expect(typeof session.meta.createdAt).toBe("number");

    const fileName = `${session.meta.id}.jsonl`;
    expect(fileName).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/);
    expect(sessionFile(session.meta.id, directory)).toBe(join(directory, fileName));

    const lines = readFileSync(join(directory, fileName), "utf8").split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? "")).toEqual(session.meta);
});

test("appendSessionMessage then loadSession round-trips messages and meta", () => {
    const directory = join(base, "round-trip");
    const created = createSession(directory);

    appendSessionMessage(created.meta.id, userMessage, directory);
    appendSessionMessage(created.meta.id, assistantMessage, directory);

    expect(loadSession(created.meta.id, directory)).toEqual({
        meta: created.meta,
        messages: [userMessage, assistantMessage]
    });

    const lines = readFileSync(sessionFile(created.meta.id, directory), "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[1] ?? "")).toEqual({ type: "message", message: userMessage });
    expect(JSON.parse(lines[2] ?? "")).toEqual({ type: "message", message: assistantMessage });
});

test("loadSession ignores corrupt and blank lines between valid records", () => {
    const directory = join(base, "corrupt");
    const created = createSession(directory);
    const file = sessionFile(created.meta.id, directory);

    appendSessionMessage(created.meta.id, userMessage, directory);
    appendFileSync(
        file,
        [
            "",
            "{not json",
            "[]",
            "null",
            '{"type":"message"}',
            '{"type":"message","message":{"role":"tool"}}',
            '{"type":"message","message":{"role":"user","content":"missing timestamp"}}',
            ""
        ].join("\n"),
        "utf8"
    );
    appendSessionMessage(created.meta.id, assistantMessage, directory);

    expect(loadSession(created.meta.id, directory)).toEqual({
        meta: created.meta,
        messages: [userMessage, assistantMessage]
    });
});

test("loadSession returns null when the file has no valid session header", () => {
    const directory = join(base, "no-header");
    mkdirSync(directory, { recursive: true });
    writeFileSync(
        join(directory, "broken.jsonl"),
        'not json\n{"type":"message","message":{"role":"user","content":"hi","timestamp":1}}\n',
        "utf8"
    );

    expect(loadSession("broken", directory)).toBeNull();
});

test("loadSession returns null for an unknown id", () => {
    const directory = join(base, "unknown");
    mkdirSync(directory, { recursive: true });

    expect(loadSession("unknown-id", directory)).toBeNull();
    expect(loadSession("00000000-0000-4000-8000-000000000000", join(base, "missing"))).toBeNull();
});

test("listSessionSummaries reads titles and counts without loading messages", () => {
    const directory = join(base, "summaries");
    const first = createSession(directory);
    appendSessionMessage(first.meta.id, userMessage, directory);
    appendSessionMessage(first.meta.id, assistantMessage, directory);
    const past = new Date(Date.now() - 60_000);
    utimesSync(sessionFile(first.meta.id, directory), past, past);

    const second = createSession(directory);
    appendSessionMessage(second.meta.id, { ...userMessage, content: "second prompt" }, directory);
    mkdirSync(join(directory, "decoy.jsonl"));

    const summaries = listSessionSummaries(directory);
    expect(summaries.map((summary) => summary.id)).toEqual([second.meta.id, first.meta.id]);
    expect(summaries[1]).toMatchObject({
        id: first.meta.id,
        title: "hello",
        createdAt: first.meta.createdAt,
        messageCount: 2
    });
    expect(summaries[0]).toMatchObject({
        id: second.meta.id,
        title: "second prompt",
        createdAt: second.meta.createdAt,
        messageCount: 1
    });
    expect(listSessionSummaries(join(base, "missing-summaries"))).toEqual([]);
});
