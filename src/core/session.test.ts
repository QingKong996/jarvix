import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test, vi } from "vitest";
import type { LlmAdapter } from "./llm/index.ts";
import type { LlmRequest } from "./llm/adapter.ts";
import type {
    LlmAssistantMessage,
    LlmMessage,
    LlmModelInfo,
    LlmStreamEvent
} from "../protocol/llm.ts";
import { loadSession } from "./session/persistence/store.ts";
import { SESSION_NAME_TIMEOUT_MS } from "./session/naming.ts";
import { Jarvix } from "./index.ts";
import type { Language } from "../protocol/config.ts";
import { providerConfigSchema } from "../protocol/providers.ts";
import {
    noopAgentObserver,
    type AgentObserver,
    type AgentRunFinished,
    type AgentRunStarted,
    type AgentTurnFinished,
    type AgentTurnStarted
} from "./observability/index.ts";
import { SESSION_NAME_MAX_LENGTH } from "../protocol/session.ts";

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

function toolCallMessage(
    name: string,
    arguments_: Record<string, unknown>
): LlmAssistantMessage {
    return {
        ...assistantMessage(""),
        content: [{
            type: "toolCall",
            id: `call-${name}`,
            name,
            arguments: arguments_
        }],
        stopReason: "toolUse"
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
            const question = request.messages.find((message) => (
                message.role === "user" &&
                message.context !== "system-reminder"
            ));
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

function stalledLlm(seen: LlmMessage[][], signals: AbortSignal[]): LlmAdapter {
    return {
        getModel: () => MODEL,
        stream(request) {
            seen.push([...request.messages]);
            if (request.signal) {
                signals.push(request.signal);
            }
            return (async function* (): AsyncIterable<LlmStreamEvent> {
                yield { type: "start" };
                await new Promise<void>(() => undefined);
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
        .toEqual(["system", "user", "assistant", "user"]);

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

test("refreshes context usage when the selected model changes", () => {
    home.path = join(base, "context-usage-config-home");
    const jarvix = new Jarvix({ llm: fakeLlm("ok", []), config: TEST_CONFIG });
    jarvix.createSession();
    const windows: number[] = [];
    jarvix.subscribe((event) => {
        if (event.type === "context.usage") {
            windows.push(event.usage.contextWindow);
        }
    });

    jarvix.setConfig({
        ...TEST_CONFIG,
        providers: [providerConfigSchema.parse({
            ...TEST_PROVIDER,
            models: [{ id: MODEL.id, name: MODEL.name, contextWindow: 64_000 }]
        })]
    });

    expect(windows).toEqual([64_000]);
});

test("returns the assembled final provider context for static inspection", async () => {
    home.path = join(base, "provider-context-home");
    const jarvix = new Jarvix({ llm: fakeLlm("ok", []), config: TEST_CONFIG });
    const project = createProject(jarvix);
    const session = jarvix.createSession({ projectId: project.id }, SESSION_NAME);

    await jarvix.request("hello", session.meta.id);

    const context = jarvix.getProviderContext(session.meta.id);
    expect(context).toMatchObject({
        systemPrompt: expect.any(String)
    });
    expect(context.messages.map((message) => message.role)).toEqual([
        "system",
        "user",
        "assistant"
    ]);
    expect(context.messages[0]).toMatchObject({
        role: "system",
        context: "environment",
        content: expect.stringContaining(join(home.path, "workspace"))
    });

    jarvix.setPermission(session.meta.id, "full-access");
    const updated = jarvix.getProviderContext(session.meta.id);
    expect(updated.messages.at(-1)).toMatchObject({
        role: "user",
        context: "system-reminder",
        content: expect.stringContaining("permission: full-access")
    });
    expect(jarvix.loadSession(session.meta.id)?.messages.map((message) => message.role))
        .toEqual(["user", "assistant"]);
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
    expect(requests.map((messages) => messages.find((message) => (
        message.role === "user" && message.context !== "system-reminder"
    ))?.content).sort()).toEqual(["first", "second"]);
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

test("records automatic naming as a separate observed run", async () => {
    home.path = join(base, "naming-observability-home");
    const runsStarted: AgentRunStarted[] = [];
    const runsFinished: AgentRunFinished[] = [];
    const turnsStarted: AgentTurnStarted[] = [];
    const turnsFinished: AgentTurnFinished[] = [];
    const observer: AgentObserver = {
        ...noopAgentObserver,
        runStarted: (run) => {
            runsStarted.push(run);
        },
        runFinished: (_runId, run) => {
            runsFinished.push(run);
        },
        turnStarted: (turn) => {
            turnsStarted.push(turn);
        },
        turnFinished: (_turnId, turn) => {
            turnsFinished.push(turn);
        }
    };
    const jarvix = new Jarvix({
        llm: {
            getModel: () => MODEL,
            stream: () => (async function* (): AsyncIterable<LlmStreamEvent> {
                yield { type: "text.delta", index: 0, delta: "Naming run" };
                await new Promise((resolve) => setTimeout(resolve, 3));
                yield {
                    type: "done",
                    message: {
                        ...assistantMessage("Naming run"),
                        usage: {
                            inputTokens: 3,
                            outputTokens: 5,
                            cacheReadTokens: 1,
                            cacheWriteTokens: 0,
                            totalTokens: 9,
                            cost: 0.0001
                        }
                    }
                };
            })()
        },
        config: TEST_CONFIG,
        observer
    });
    const session = jarvix.createSession({}, SESSION_NAME);

    expect(await jarvix.autoNameSession(session.meta.id, "Name this session"))
        .toBe("Naming run");
    expect(runsStarted).toHaveLength(1);
    expect(runsStarted[0]).toMatchObject({
        sessionId: session.meta.id,
        runType: "naming",
        promptChars: "Name this session".length
    });
    expect(turnsStarted).toHaveLength(1);
    expect(turnsStarted[0]).toMatchObject({
        runId: runsStarted[0]?.runId,
        turnKind: "naming",
        turnIndex: 0
    });
    expect(turnsFinished[0]).toMatchObject({
        outcome: "completed",
        firstTokenKind: "text",
        inputTokens: 3,
        outputTokens: 5
    });
    expect(runsFinished[0]).toMatchObject({
        outcome: "completed",
        llmTurns: 1,
        toolCalls: 0,
        agentSteps: 0,
        inputTokens: 3,
        outputTokens: 5,
        finalStopReason: "stop"
    });
});

test("names released sessions without loading their full history", async () => {
    home.path = join(base, "rename-released-home");
    const directory = join(home.path, ".jarvix", "sessions");
    const requests: LlmMessage[][] = [];
    const jarvix = new Jarvix({
        llm: fakeLlm("Stored prompt title", requests),
        config: TEST_CONFIG
    });
    const session = jarvix.createSession({}, SESSION_NAME);
    await jarvix.request("Persisted prompt", session.meta.id);

    expect(jarvix.releaseSession(session.meta.id)).toBe(true);
    expect(await jarvix.autoNameSession(session.meta.id)).toBe("Stored prompt title");
    expect(requests.at(-1)?.[0]).toMatchObject({
        role: "user",
        content: "Persisted prompt"
    });
    expect(loadSession(session.meta.id, directory)?.meta.name).toBe("Stored prompt title");
    expect(jarvix.releaseSession(session.meta.id)).toBe(false);
});

test("does not overwrite a title changed while automatic naming is in flight", async () => {
    home.path = join(base, "naming-race-home");
    const directory = join(home.path, ".jarvix", "sessions");
    const requests: LlmMessage[][] = [];
    let releaseName!: () => void;
    const nameGate = new Promise<void>((resolve) => {
        releaseName = resolve;
    });
    const jarvix = new Jarvix({
        llm: gatedLlm(requests, nameGate),
        config: TEST_CONFIG
    });
    const session = jarvix.createSession({}, SESSION_NAME);

    const naming = jarvix.autoNameSession(session.meta.id, "Name this session");
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    expect(jarvix.releaseSession(session.meta.id)).toBe(true);
    expect(jarvix.renameSession(session.meta.id, "Manual title")).toBe("Manual title");
    const reloaded = jarvix.loadSession(session.meta.id);
    const events: string[] = [];
    jarvix.subscribe((event) => {
        if (event.type === "session.renamed") {
            events.push(event.name);
        }
    });

    releaseName();

    expect(await naming).toBe("Manual title");
    expect(events).toEqual([]);
    expect(reloaded?.meta.name).toBe("Manual title");
    expect(loadSession(session.meta.id, directory)?.meta.name).toBe("Manual title");
});

test("times out session auto-naming when the provider stream stalls", async () => {
    home.path = join(base, "naming-timeout-home");
    const requests: LlmMessage[][] = [];
    const signals: AbortSignal[] = [];
    const jarvix = new Jarvix({
        llm: stalledLlm(requests, signals),
        config: TEST_CONFIG
    });
    const session = jarvix.createSession({}, SESSION_NAME);
    vi.useFakeTimers();

    try {
        const naming = expect(jarvix.autoNameSession(session.meta.id, "Stalled prompt"))
            .rejects.toThrow("Session naming timed out");
        await vi.advanceTimersByTimeAsync(SESSION_NAME_TIMEOUT_MS);
        await naming;
    } finally {
        vi.useRealTimers();
    }

    expect(requests).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
    expect(jarvix.loadSession(session.meta.id)?.meta.name).toBe(SESSION_NAME);
});

test("bounds automatic naming output when a provider ignores max tokens", async () => {
    home.path = join(base, "naming-output-bound-home");
    const jarvix = new Jarvix({
        llm: fakeLlm("x".repeat(100_000), []),
        config: TEST_CONFIG
    });
    const session = jarvix.createSession({}, SESSION_NAME);

    expect(await jarvix.autoNameSession(session.meta.id, "Name this session"))
        .toBe("x".repeat(SESSION_NAME_MAX_LENGTH));
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

test("emits each goal change and context refresh exactly once", async () => {
    home.path = join(base, "goal-events-home");
    const jarvix = new Jarvix({
        llm: fakeLlm("ok", []),
        config: TEST_CONFIG
    });
    const session = jarvix.createSession({}, SESSION_NAME);
    await jarvix.request("warm the session", session.meta.id);

    const goalEvents: Array<unknown> = [];
    let contextUsageEvents = 0;
    jarvix.subscribe((event) => {
        if (event.type === "goal.updated") {
            goalEvents.push(event.goal);
        } else if (event.type === "context.usage") {
            contextUsageEvents += 1;
        }
    });

    const first = jarvix.setGoal(session.meta.id, "First goal");
    const second = jarvix.setGoal(session.meta.id, "Second goal");
    jarvix.clearGoal(session.meta.id);

    expect(goalEvents).toEqual([first, second, null]);
    expect(contextUsageEvents).toBe(3);
});

test("restores a goal without running it and uses a fresh verifier for finish_goal", async () => {
    home.path = join(base, "goal-home");
    const requests: LlmRequest[] = [];
    const llm: LlmAdapter = {
        getModel: () => MODEL,
        stream(request) {
            requests.push({
                ...request,
                messages: [...request.messages]
            });
            const verifier = request.systemPrompt?.includes("independent goal verifier") === true;
            const message = verifier
                ? toolCallMessage("verify_result", {
                    passed: true,
                    reason: "The result is present."
                })
                : toolCallMessage("finish_goal", {});
            return (async function* (): AsyncIterable<LlmStreamEvent> {
                yield { type: "start" };
                yield { type: "done", message };
            })();
        }
    };
    const jarvix = new Jarvix({ llm, config: TEST_CONFIG });
    const session = jarvix.createSession({}, SESSION_NAME);
    jarvix.setGoal(session.meta.id, "Ship feature A");

    const restarted = new Jarvix({ llm, config: TEST_CONFIG });
    expect(restarted.loadSession(session.meta.id)?.meta.goal?.content)
        .toBe("Ship feature A");
    expect(requests).toHaveLength(0);

    await restarted.request("", session.meta.id);

    expect(requests).toHaveLength(2);
    expect(requests[0]?.messages.at(-1)).toMatchObject({
        role: "system",
        context: "goal",
        content: expect.stringContaining("<goal>\nShip feature A\n</goal>")
    });
    expect(requests[0]?.tools?.map((tool) => tool.name)).toContain("finish_goal");
    expect(requests[1]?.systemPrompt).toContain("independent goal verifier");
    expect(requests[1]?.tools?.map((tool) => tool.name)).toContain("verify_result");
    expect(requests[1]?.tools?.map((tool) => tool.name)).not.toContain("finish_goal");
    expect(requests[1]?.tools?.map((tool) => tool.name)).not.toContain("update_goal");
    expect(requests[1]?.messages.map((message) => message.role)).toEqual([
        "system",
        "user"
    ]);
    expect(requests[1]?.messages[1]).toMatchObject({
        role: "user",
        content: "<goal>\nShip feature A\n</goal>"
    });
    expect(restarted.loadSession(session.meta.id)?.meta.goal).toBeUndefined();
});

test("continues an injected prompt normally after goal verification succeeds", async () => {
    home.path = join(base, "goal-injected-prompt-home");
    const requests: LlmRequest[] = [];
    let mainCalls = 0;
    let releaseVerifier!: () => void;
    let verifierStarted!: () => void;
    const verifierGate = new Promise<void>((resolve) => {
        releaseVerifier = resolve;
    });
    const verifierReady = new Promise<void>((resolve) => {
        verifierStarted = resolve;
    });
    const llm: LlmAdapter = {
        getModel: () => MODEL,
        stream(request) {
            requests.push({
                ...request,
                messages: [...request.messages]
            });
            if (request.systemPrompt?.includes("independent goal verifier")) {
                verifierStarted();
                return (async function* (): AsyncIterable<LlmStreamEvent> {
                    await verifierGate;
                    yield {
                        type: "done",
                        message: toolCallMessage("verify_result", {
                            passed: true,
                            reason: "The goal is complete."
                        })
                    };
                })();
            }

            mainCalls += 1;
            const message = mainCalls === 1
                ? toolCallMessage("finish_goal", {})
                : mainCalls === 2
                    ? toolCallMessage("get_local_time", {})
                    : assistantMessage("Follow-up complete.");
            return (async function* (): AsyncIterable<LlmStreamEvent> {
                yield { type: "done", message };
            })();
        }
    };
    const jarvix = new Jarvix({ llm, config: TEST_CONFIG });
    const session = jarvix.createSession({}, SESSION_NAME);
    jarvix.setGoal(session.meta.id, "Ship feature A");

    const request = jarvix.request("", session.meta.id);
    await verifierReady;
    const injected = jarvix.injectPrompt(
        "Now explain the result",
        session.meta.id,
        "prompt-after-verification"
    );
    releaseVerifier();
    await request;

    expect(injected).toBe(true);
    expect(mainCalls).toBe(3);
    expect(requests).toHaveLength(4);
    expect(requests[2]?.messages.some((message) => (
        message.role === "user" &&
        message.content === "Now explain the result"
    ))).toBe(true);
    expect(jarvix.loadSession(session.meta.id)?.messages.at(-1)).toMatchObject({
        role: "assistant",
        content: [{ type: "text", text: "Follow-up complete." }]
    });
});
