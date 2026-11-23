import {
    appendFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    utimesSync,
    writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, expect, test, vi } from "vitest";
import type { LlmAssistantMessage, LlmUserMessage } from "../../../protocol/llm.ts";
import { DEFAULT_PERMISSION_MODE } from "../../../protocol/permission.ts";
import type { JarvixSessionMeta } from "../../../protocol/session.ts";
import {
    SESSION_FORMAT_VERSION,
    appendSessionMessage,
    createSession,
    deleteSession,
    listArchivedSessionSummaries,
    listSessionSummaries,
    loadSession,
    sessionFile,
    updateSessionContext,
    updateSessionName,
    updateSessionPermission,
    updateSessionStatus
} from "./store.ts";

const base = mkdtempSync(join(tmpdir(), "jarvix-session-"));
const SESSION_NAME = "Untitled session";
const PROJECT_ID = "10000000-0000-4000-8000-000000000001";

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

test.each([
    "",
    ".",
    "..",
    "../outside",
    "..\\outside",
    "nested/session",
    "nested\\session",
    "invalid\u0000id",
    "CON",
    " CON "
])("sessionFile rejects unsafe id %j", (id) => {
    expect(() => sessionFile(id, base)).toThrow("Invalid session id");
});

test("createSession writes the current header version to a <uuid>.jsonl file", () => {
    const directory = join(base, "create");
    const session = createSession({ projectId: PROJECT_ID }, SESSION_NAME, directory);

    expect(session.messages).toEqual([]);
    expect(session.meta.type).toBe("session");
    expect(session.meta.version).toBe(SESSION_FORMAT_VERSION);
    expect(session.meta.name).toBe(SESSION_NAME);
    expect(session.meta.projectId).toBe(PROJECT_ID);
    expect(session.meta.permission).toBe(DEFAULT_PERMISSION_MODE);
    expect(typeof session.meta.createdAt).toBe("number");

    const fileName = `${session.meta.id}.jsonl`;
    expect(fileName).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/);
    expect(sessionFile(session.meta.id, directory)).toBe(join(directory, fileName));

    const lines = readFileSync(join(directory, fileName), "utf8").split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? "")).toEqual(session.meta);
});

test("createSession defaults to a temporary session", () => {
    const directory = join(base, "temporary");
    const session = createSession({}, SESSION_NAME, directory);

    expect(session.meta.projectId).toBeUndefined();
    expect(session.meta.workingDirectory).toBeUndefined();
    const summary = listSessionSummaries(directory)[0];
    expect(summary?.id).toBe(session.meta.id);
    expect(summary?.projectId).toBeUndefined();
    expect(summary?.workingDirectory).toBeUndefined();
});

test.each([undefined, "", "   "])("createSession gives %j the default name", (name) => {
    const directory = join(base, "default-name");
    const session = createSession({ projectId: PROJECT_ID }, name, directory);

    expect(session.meta.name).toBe("未命名会话");
    expect(loadSession(session.meta.id, directory)?.meta.name).toBe("未命名会话");
});

test("createSession rejects headers larger than the read limit without creating the directory", () => {
    const directory = join(base, "oversized-create");

    expect(() => createSession(
        { projectId: "x".repeat(1024 * 1024) },
        SESSION_NAME,
        directory
    )).toThrow(/safe size limit/);
    expect(existsSync(directory)).toBe(false);
});

test("appendSessionMessage then loadSession round-trips messages and meta", () => {
    const directory = join(base, "round-trip");
    const created = createSession({ projectId: PROJECT_ID }, SESSION_NAME, directory);

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

test("round-trips context reminder and environment markers", () => {
    const directory = join(base, "context-markers");
    const created = createSession({ projectId: PROJECT_ID }, SESSION_NAME, directory);
    const environment = {
        role: "system" as const,
        content: "<environment_context>\n- permission: read-only\n</environment_context>",
        context: "environment" as const,
        environmentKey: "[\"read-only\",[]]",
        timestamp: 2
    };
    const reminder: LlmUserMessage = {
        role: "user",
        content: "<system-reminder>\nThe session environment changed.\n</system-reminder>",
        context: "system-reminder",
        timestamp: 3
    };

    appendSessionMessage(created.meta.id, environment, directory);
    appendSessionMessage(created.meta.id, reminder, directory);

    expect(loadSession(created.meta.id, directory)?.messages).toEqual([environment, reminder]);
});

test("loadSession ignores corrupt and blank lines between valid records", () => {
    const directory = join(base, "corrupt");
    const created = createSession({ projectId: PROJECT_ID }, SESSION_NAME, directory);
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

test("appendSessionMessage isolates a partial trailing record", () => {
    const directory = join(base, "partial-tail");
    const created = createSession({ projectId: PROJECT_ID }, SESSION_NAME, directory);
    const file = sessionFile(created.meta.id, directory);
    appendFileSync(file, '{"type":"message","message":{"role":"user",', "utf8");

    appendSessionMessage(created.meta.id, assistantMessage, directory);

    expect(loadSession(created.meta.id, directory)).toEqual({
        meta: created.meta,
        messages: [assistantMessage]
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

test("loadSession returns null when the header id does not match the file id", () => {
    const directory = join(base, "mismatched-header");
    mkdirSync(directory, { recursive: true });
    const meta: JarvixSessionMeta = {
        type: "session",
        version: SESSION_FORMAT_VERSION,
        id: "different-session",
        name: "Mismatched session",
        createdAt: 1_700_000_000_000,
        status: "active",
        permission: DEFAULT_PERMISSION_MODE
    };
    writeFileSync(
        join(directory, "requested-session.jsonl"),
        `${JSON.stringify(meta)}\n`,
        "utf8"
    );

    expect(loadSession("requested-session", directory)).toBeNull();
});

test("loadSession returns null for an unknown id", () => {
    const directory = join(base, "unknown");
    mkdirSync(directory, { recursive: true });

    expect(loadSession("unknown-id", directory)).toBeNull();
    expect(loadSession("00000000-0000-4000-8000-000000000000", join(base, "missing"))).toBeNull();
});

test("loadSession defaults legacy sessions to read-only", () => {
    const directory = join(base, "legacy-header");
    const id = "legacy-session";
    mkdirSync(directory, { recursive: true });
    writeFileSync(sessionFile(id, directory), `${JSON.stringify({
        type: "session",
        version: 1,
        id,
        name: "Legacy session",
        createdAt: 1_700_000_000_000,
        status: "active"
    })}\n`, "utf8");

    expect(loadSession(id, directory)?.meta).toMatchObject({
        id,
        name: "Legacy session",
        status: "active",
        permission: "read-only"
    });
});

test("listSessionSummaries reads names from headers without loading messages", () => {
    const directory = join(base, "summaries");
    const firstMeta: JarvixSessionMeta = {
        type: "session",
        version: SESSION_FORMAT_VERSION,
        id: "named-session",
        name: "Named session",
        createdAt: 1_700_000_000_000,
        status: "active",
        permission: DEFAULT_PERMISSION_MODE
    };
    mkdirSync(directory, { recursive: true });
    writeFileSync(sessionFile(firstMeta.id, directory), `${JSON.stringify(firstMeta)}\n`, "utf8");
    appendSessionMessage(firstMeta.id, { ...userMessage, content: "not the title" }, directory);

    const past = new Date(Date.now() - 60_000);
    utimesSync(sessionFile(firstMeta.id, directory), past, past);

    const second = createSession({ projectId: PROJECT_ID }, "Another session", directory);
    mkdirSync(join(directory, "decoy.jsonl"));

    const summaries = listSessionSummaries(directory);
    expect(summaries.map((summary) => summary.id)).toEqual([second.meta.id, firstMeta.id]);
    expect(summaries[1]).toMatchObject({
        id: firstMeta.id,
        name: "Named session",
        createdAt: firstMeta.createdAt
    });
    expect(summaries[0]).toMatchObject({
        id: second.meta.id,
        name: "Another session",
        createdAt: second.meta.createdAt
    });
    expect(Object.keys(summaries[0]!).sort()).toEqual([
        "createdAt",
        "id",
        "name",
        "projectId",
        "status",
        "updatedAt"
    ]);
    expect(listSessionSummaries(join(base, "missing-summaries"))).toEqual([]);
});

test("updateSessionContext switches between a project and a custom working directory", () => {
    const directory = join(base, "context");
    const workspace = join(base, "custom-workspace");
    const created = createSession({}, SESSION_NAME, directory);
    appendSessionMessage(created.meta.id, userMessage, directory);

    const custom = updateSessionContext(created.meta.id, {
        workingDirectory: workspace
    }, directory);
    expect(custom.workingDirectory).toBe(resolve(workspace));
    expect(custom.projectId).toBeUndefined();

    const project = updateSessionContext(created.meta.id, {
        projectId: PROJECT_ID
    }, directory);
    expect(project.projectId).toBe(PROJECT_ID);
    expect(project.workingDirectory).toBeUndefined();
    expect(loadSession(created.meta.id, directory)?.meta).toEqual(project);

    const temporary = updateSessionContext(created.meta.id, {}, directory);
    expect(temporary.projectId).toBeUndefined();
    expect(temporary.workingDirectory).toBeUndefined();
    expect(loadSession(created.meta.id, directory)).toEqual({
        meta: temporary,
        messages: [userMessage]
    });
});

test("updateSessionContext rejects oversized headers and preserves the existing session", () => {
    const directory = join(base, "oversized-update");
    const created = createSession({}, SESSION_NAME, directory);
    const file = sessionFile(created.meta.id, directory);
    const before = readFileSync(file, "utf8");

    expect(() => updateSessionContext(
        created.meta.id,
        { projectId: "x".repeat(1024 * 1024) },
        directory
    )).toThrow(/safe size limit/);

    expect(readFileSync(file, "utf8")).toBe(before);
    expect(loadSession(created.meta.id, directory)).toEqual(created);
});

test("updateSessionName rewrites the header and preserves messages", () => {
    const directory = join(base, "rename");
    const created = createSession({ projectId: PROJECT_ID }, SESSION_NAME, directory);
    appendSessionMessage(created.meta.id, userMessage, directory);

    const meta = updateSessionName(created.meta.id, "  Renamed session  ", directory);

    expect(meta.name).toBe("Renamed session");
    expect(loadSession(created.meta.id, directory)).toEqual({
        meta,
        messages: [userMessage]
    });
    expect(listSessionSummaries(directory)[0]?.name).toBe("Renamed session");
    expect(() => updateSessionName(created.meta.id, "   ", directory)).toThrow();
});

test("updateSessionPermission rewrites the header and preserves messages", () => {
    const directory = join(base, "permission");
    const created = createSession({ projectId: PROJECT_ID }, SESSION_NAME, directory);
    appendSessionMessage(created.meta.id, userMessage, directory);

    const meta = updateSessionPermission(created.meta.id, "project-read-write", directory);

    expect(meta.permission).toBe("project-read-write");
    expect(loadSession(created.meta.id, directory)).toEqual({
        meta,
        messages: [userMessage]
    });
});

test("updateSessionStatus archives in the header and sorts archives by archive time", () => {
    const directory = join(base, "archive");
    const first = createSession({ projectId: PROJECT_ID }, "First archived", directory);
    const second = createSession({}, "Second archived", directory);
    appendSessionMessage(first.meta.id, userMessage, directory);

    const firstArchived = updateSessionStatus(first.meta.id, "archived", directory, 1_700_000_500_000);
    updateSessionStatus(second.meta.id, "archived", directory, 1_700_000_600_000);

    expect(firstArchived).toMatchObject({
        status: "archived",
        archivedAt: 1_700_000_500_000
    });
    expect(loadSession(first.meta.id, directory)).toEqual({
        meta: firstArchived,
        messages: [userMessage]
    });
    expect(listArchivedSessionSummaries(directory).map((session) => session.id))
        .toEqual([second.meta.id, first.meta.id]);

    const restored = updateSessionStatus(first.meta.id, "active", directory);

    expect(restored.status).toBe("active");
    expect(restored.archivedAt).toBeUndefined();
    expect(listArchivedSessionSummaries(directory).map((session) => session.id))
        .toEqual([second.meta.id]);
});

test("deleteSession permanently removes the session file", () => {
    const directory = join(base, "delete");
    const session = createSession({}, "Delete me", directory);
    appendSessionMessage(session.meta.id, userMessage, directory);

    deleteSession(session.meta.id, directory);

    expect(loadSession(session.meta.id, directory)).toBeNull();
    expect(listSessionSummaries(directory)).toEqual([]);
    expect(() => deleteSession(session.meta.id, directory)).toThrow("Session not found");
});

test("listSessionSummaries sorts by the last message timestamp", () => {
    const directory = join(base, "message-sort");
    const older = createSession({ projectId: PROJECT_ID }, "Older activity", directory);
    const newer = createSession({ projectId: PROJECT_ID }, "Newer activity", directory);
    appendSessionMessage(older.meta.id, {
        ...userMessage,
        timestamp: 1_700_000_100_000
    }, directory);
    appendSessionMessage(newer.meta.id, {
        ...userMessage,
        timestamp: 1_700_000_200_000
    }, directory);

    const past = new Date(Date.now() - 120_000);
    const future = new Date(Date.now() + 120_000);
    utimesSync(sessionFile(older.meta.id, directory), future, future);
    utimesSync(sessionFile(newer.meta.id, directory), past, past);

    const summaries = listSessionSummaries(directory);
    expect(summaries.map((summary) => summary.id)).toEqual([newer.meta.id, older.meta.id]);
    expect(summaries.map((summary) => summary.updatedAt)).toEqual([1_700_000_200_000, 1_700_000_100_000]);
});

test("listSessionSummaries finds a last message larger than the tail chunk", () => {
    const directory = join(base, "large-tail");
    const session = createSession({ projectId: PROJECT_ID }, "Large message", directory);
    const timestamp = 1_700_000_300_000;
    appendSessionMessage(session.meta.id, {
        ...userMessage,
        content: "x".repeat(70 * 1024),
        timestamp
    }, directory);

    expect(listSessionSummaries(directory)[0]?.updatedAt).toBe(timestamp);
});

test("listSessionSummaries reads a huge final record without repeated buffer concatenation", () => {
    const directory = join(base, "huge-tail");
    const session = createSession({ projectId: PROJECT_ID }, "Huge message", directory);
    const timestamp = 1_700_000_400_000;
    appendSessionMessage(session.meta.id, {
        ...userMessage,
        content: "x".repeat(4 * 1024 * 1024),
        timestamp
    }, directory);
    const concatenate = vi.spyOn(Buffer, "concat");

    try {
        expect(listSessionSummaries(directory)[0]?.updatedAt).toBe(timestamp);
        expect(concatenate).not.toHaveBeenCalled();
    } finally {
        concatenate.mockRestore();
    }
});

test("loadSession rejects headers without a non-empty name", () => {
    const directory = join(base, "missing-name");
    const meta = {
        type: "session",
        version: SESSION_FORMAT_VERSION,
        id: "unnamed-session",
        createdAt: 1_700_000_000_000
    };
    mkdirSync(directory, { recursive: true });
    writeFileSync(
        sessionFile(meta.id, directory),
        `${JSON.stringify(meta)}\n`,
        "utf8"
    );

    expect(loadSession(meta.id, directory)).toBeNull();
    expect(listSessionSummaries(directory)).toEqual([]);
});
