import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test, vi } from "vitest";
import type { LlmAdapter, LlmAssistantMessage, LlmMessage, LlmModelInfo, LlmStreamEvent } from "../llm/index.ts";
import { loadSession } from "./session/store.ts";
import { Jarvix } from "./index.ts";
import type { Language } from "../protocol/config.ts";
import { providerConfigSchema } from "../protocol/providers.ts";

const home = vi.hoisted(() => ({ path: "" }));

vi.mock("node:os", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:os")>();
    return { ...actual, homedir: () => home.path };
});

const base = mkdtempSync(join(tmpdir(), "jarvix-core-session-"));
const SESSION_NAME = "Untitled session";

const MODEL: LlmModelInfo = {
    provider: "test",
    id: "test-model",
    name: "Test",
    reasoning: false,
    contextWindow: 1000,
    maxTokens: 100
};
const TEST_PROVIDER = providerConfigSchema.parse({
    id: MODEL.provider, name: MODEL.name, protocol: "openai-completions", baseUrl: "http://localhost:8080/v1",
    models: [{ id: MODEL.id, name: MODEL.name }]
});
const TEST_CONFIG = {
    providers: [TEST_PROVIDER],
    selectedModel: { provider: MODEL.provider, id: MODEL.id }
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

function createProject(jarvix: Jarvix, name = "Test project") {
    return jarvix.createProject(name, [join(home.path, "workspace")]);
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

    const first = new Jarvix({ llm: fakeLlm("first reply", requests), config: TEST_CONFIG });
    const project = createProject(first);
    const firstSession = first.createSession({ projectId: project.id }, SESSION_NAME);
    await first.request("first question", firstSession.meta.id);

    const stored = loadSession(firstSession.meta.id, directory);
    if (!stored) {
        throw new Error("Expected the first session to be persisted");
    }
    expect(stored?.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(stored?.messages[0]).toMatchObject({ role: "user", content: "first question" });

    const second = new Jarvix({ llm: fakeLlm("second reply", requests), config: TEST_CONFIG });
    expect(second.loadSession(stored.meta.id)?.messages).toHaveLength(2);
    await second.request("second question", stored.meta.id);

    expect(requests[1]?.map((message) => message.role))
        .toEqual(["user", "assistant", "user", "system"]);

    const reloaded = loadSession(stored.meta.id, directory);
    expect(reloaded?.messages.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant"]);
});

test.each<{ language: Language; name: string }>([
    { language: "zh", name: "未命名会话" },
    { language: "en", name: "Untitled session" }
])("creates a session with the default name in $language and persists messages", async ({ language, name }) => {
    home.path = join(base, `lazy-${language}-home`);
    const directory = join(home.path, ".jarvix", "sessions");
    const jarvix = new Jarvix({ llm: fakeLlm("ok", []), config: { ...TEST_CONFIG, language } });
    const project = createProject(jarvix);

    expect(jarvix.listSessions()).toEqual([]);

    const created = jarvix.createSession({ projectId: project.id });
    expect(created.meta.name).toBe(name);
    await jarvix.request("hello", created.meta.id);

    const session = jarvix.loadSession(created.meta.id);
    expect(loadSession(created.meta.id, directory)?.meta.name).toBe(name);
    expect(session?.messages).toHaveLength(2);
    expect(loadSession(session?.meta.id ?? "", directory)?.messages).toHaveLength(2);
});

test("uses the current configured language when creating a session with a blank name", () => {
    home.path = join(base, "default-name-home");
    const jarvix = new Jarvix({ llm: fakeLlm("ok", []), config: { language: "zh" } });
    const project = createProject(jarvix);

    expect(jarvix.createSession({ projectId: project.id }, "   ").meta.name).toBe("未命名会话");

    jarvix.setConfig({ language: "en" });

    expect(jarvix.createSession({ projectId: project.id }, "").meta.name).toBe("Untitled session");
});

test("runs separate sessions in parallel with isolated histories", async () => {
    home.path = join(base, "parallel-home");
    const directory = join(home.path, ".jarvix", "sessions");
    const requests: LlmMessage[][] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const jarvix = new Jarvix({ llm: gatedLlm(requests, gate), config: TEST_CONFIG });
    const project = createProject(jarvix);
    const first = jarvix.createSession({ projectId: project.id }, "First session");
    const second = jarvix.createSession({ projectId: project.id }, "Second session");
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
    expect(summaries.map((session) => session.name).sort()).toEqual(["First session", "Second session"]);
});

test("rejects a second request in the same session", async () => {
    home.path = join(base, "busy-home");
    const requests: LlmMessage[][] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const jarvix = new Jarvix({ llm: gatedLlm(requests, gate), config: TEST_CONFIG });
    const project = createProject(jarvix);
    const session = jarvix.createSession({ projectId: project.id }, SESSION_NAME);

    const firstRequest = jarvix.request("first", session.meta.id);
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    await expect(jarvix.request("second", session.meta.id))
        .rejects.toThrow(`Session is busy: ${session.meta.id}`);

    release();
    await firstRequest;
    expect(jarvix.loadSession(session.meta.id)?.messages).toHaveLength(2);
});

test("renames sessions manually and from the first user prompt", async () => {
    home.path = join(base, "rename-home");
    const directory = join(home.path, ".jarvix", "sessions");
    const requests: LlmMessage[][] = [];
    const jarvix = new Jarvix({
        llm: fakeLlm('  **"Focused title".**  ', requests),
        config: TEST_CONFIG
    });
    const session = jarvix.createSession({}, SESSION_NAME);
    await jarvix.request("Explain the session naming flow", session.meta.id);

    const renamed: string[] = [];
    jarvix.subscribe((event) => {
        if (event.type === "session.renamed") {
            renamed.push(event.name);
        }
    });

    expect(jarvix.renameSession(session.meta.id, "  Manual title  ")).toBe("Manual title");
    expect(loadSession(session.meta.id, directory)?.meta.name).toBe("Manual title");

    expect(await jarvix.autoNameSession(session.meta.id)).toBe("Focused title");
    expect(requests.at(-1)?.[0]).toMatchObject({
        role: "user",
        content: "Explain the session naming flow"
    });
    expect(loadSession(session.meta.id, directory)?.meta.name).toBe("Focused title");
    expect(renamed).toEqual(["Manual title", "Focused title"]);
});

test("creates temporary sessions by default and validates explicit project context", () => {
    home.path = join(base, "project-required-home");
    const jarvix = new Jarvix({ llm: fakeLlm("ok", []), config: TEST_CONFIG });

    expect(() => jarvix.createSession({ projectId: "30000000-0000-4000-8000-000000000003" }))
        .toThrow("Project not found");

    const temporary = jarvix.createSession();
    expect(temporary.meta.projectId).toBeUndefined();
    expect(jarvix.listSessions().find((item) => item.id === temporary.meta.id)?.projectId).toBeUndefined();

    const project = createProject(jarvix);
    const session = jarvix.createSession({ projectId: project.id }, SESSION_NAME);
    expect(session.meta.projectId).toBe(project.id);
    expect(jarvix.listSessions().find((item) => item.id === session.meta.id)?.projectId).toBe(project.id);

    jarvix.updateSessionContext(session.meta.id, {});
    expect(jarvix.loadSession(session.meta.id)?.meta.projectId).toBeUndefined();
    expect(jarvix.listSessions().find((item) => item.id === session.meta.id)?.projectId).toBeUndefined();
});

test("updates a session to a custom working directory", () => {
    home.path = join(base, "custom-context-home");
    const jarvix = new Jarvix({ llm: fakeLlm("ok", []), config: TEST_CONFIG });
    const session = jarvix.createSession();
    const workspace = join(home.path, "custom-workspace");

    jarvix.updateSessionContext(session.meta.id, { workingDirectory: workspace });

    expect(jarvix.loadSession(session.meta.id)?.meta.workingDirectory).toBe(workspace);
    const summary = jarvix.listSessions()[0];
    expect(summary?.projectId).toBeUndefined();
    expect(summary?.workingDirectory).toBe(workspace);
});

test("hides archived sessions from the active list and restores them", () => {
    home.path = join(base, "archive-home");
    const jarvix = new Jarvix({ llm: fakeLlm("ok", []), config: TEST_CONFIG });
    const first = jarvix.createSession({}, "First session");
    const second = jarvix.createSession({}, "Second session");

    jarvix.archiveSession(first.meta.id);

    expect(jarvix.listSessions().map((session) => session.id)).toEqual([second.meta.id]);
    expect(jarvix.listArchivedSessions()).toMatchObject([{
        id: first.meta.id,
        status: "archived",
        archivedAt: expect.any(Number)
    }]);
    expect(jarvix.loadSession(first.meta.id)?.meta.status).toBe("archived");

    jarvix.unarchiveSession(first.meta.id);

    expect(jarvix.listArchivedSessions()).toEqual([]);
    expect(jarvix.listSessions().map((session) => session.id).sort())
        .toEqual([first.meta.id, second.meta.id].sort());
    expect(jarvix.loadSession(first.meta.id)?.meta.status).toBe("active");
});

test("permanently deletes a session", () => {
    home.path = join(base, "delete-home");
    const jarvix = new Jarvix({ llm: fakeLlm("ok", []), config: TEST_CONFIG });
    const session = jarvix.createSession({}, "Delete me");

    jarvix.deleteSession(session.meta.id);

    expect(jarvix.listSessions()).toEqual([]);
    expect(jarvix.loadSession(session.meta.id)).toBeNull();
    expect(() => jarvix.deleteSession(session.meta.id)).toThrow("Session not found");
});

test("persists permissions in session metadata", () => {
    home.path = join(base, "permission-home");
    const sessionDirectory = join(home.path, ".jarvix", "sessions");
    const jarvix = new Jarvix({ llm: fakeLlm("ok", []), config: TEST_CONFIG });
    const session = jarvix.createSession({}, "Permission session", "project-read-write");

    expect(jarvix.getPermission(session.meta.id)).toBe("project-read-write");
    expect(loadSession(session.meta.id, sessionDirectory)?.meta.permission)
        .toBe("project-read-write");

    const reloaded = new Jarvix({ llm: fakeLlm("ok", []), config: TEST_CONFIG });
    expect(reloaded.getPermission(session.meta.id)).toBe("project-read-write");
    reloaded.setPermission(session.meta.id, "full-access");
    expect(reloaded.getPermission(session.meta.id)).toBe("full-access");
    expect(loadSession(session.meta.id, sessionDirectory)?.meta.permission)
        .toBe("full-access");
});
