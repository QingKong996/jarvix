import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test, vi } from "vitest";
import type { LlmAdapter } from "../../llm/index.ts";
import type { LlmAssistantMessage, LlmModelInfo, LlmStreamEvent } from "../../llm/types.ts";
import { providerConfigSchema } from "../../protocol/providers.ts";
import { APPLY_PATCH_TOOL } from "../tools/index.ts";
import { SessionManager } from "./manager.ts";

const home = vi.hoisted(() => ({ path: "" }));

vi.mock("node:os", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:os")>();
    return { ...actual, homedir: () => home.path };
});

const base = mkdtempSync(join(tmpdir(), "jarvix-session-manager-"));
const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
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

test("creates and tracks independent sessions", () => {
    home.path = join(base, "create-home");
    const manager = new SessionManager();

    const first = manager.create({ projectId: PROJECT_ID }, "First session");
    const second = manager.create({ projectId: PROJECT_ID }, "Second session");

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
    const session = manager.create({ projectId: PROJECT_ID }, "Untitled session");

    await session.request("hello", {
        llm: fakeLlm(),
        config: TEST_CONFIG,
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

test("moves a session between projects and clears the association for temporary sessions", () => {
    home.path = join(base, "move-home");
    const manager = new SessionManager();
    const session = manager.create({ projectId: PROJECT_ID }, "Movable session");
    const nextProjectId = "20000000-0000-4000-8000-000000000002";

    expect(manager.updateContext(session.meta.id, { projectId: nextProjectId }))
        .toEqual({ projectId: nextProjectId });
    expect(session.meta.projectId).toBe(nextProjectId);
    expect(manager.listSummaries()[0]?.projectId).toBe(nextProjectId);

    expect(manager.updateContext(session.meta.id, {})).toEqual({});
    expect(session.meta.projectId).toBeUndefined();
    expect(manager.listSummaries()[0]?.projectId).toBeUndefined();
});

test("updates a session context in memory and on disk", () => {
    home.path = join(base, "context-home");
    const manager = new SessionManager();
    const session = manager.create({}, "Context session");
    const directory = join(base, "custom-directory");

    manager.updateContext(session.meta.id, { workingDirectory: directory });
    expect(session.meta.projectId).toBeUndefined();
    expect(session.meta.workingDirectory).toBe(directory);
    expect(manager.listSummaries()[0]?.workingDirectory).toBe(directory);

    manager.updateContext(session.meta.id, { projectId: PROJECT_ID });
    expect(session.meta.projectId).toBe(PROJECT_ID);
    expect(session.meta.workingDirectory).toBeUndefined();
});

test("updates metadata without loading unopened session history", () => {
    home.path = join(base, "metadata-only-home");
    const created = new SessionManager().create({}, "Metadata session");
    const manager = new SessionManager();
    const directory = join(base, "metadata-directory");

    expect(manager.listLoaded()).toHaveLength(0);

    manager.rename(created.meta.id, "Renamed session");
    manager.updateStatus(created.meta.id, "archived");
    manager.updateContext(created.meta.id, { workingDirectory: directory });
    manager.updatePermission(created.meta.id, "project-read-write");

    expect(manager.listLoaded()).toHaveLength(0);
    expect(manager.listSummaries()[0]).toMatchObject({
        id: created.meta.id,
        name: "Renamed session",
        status: "archived",
        workingDirectory: directory
    });

    const loaded = manager.load(created.meta.id);
    expect(loaded?.meta).toMatchObject({
        name: "Renamed session",
        permission: "project-read-write"
    });
    expect(manager.listLoaded()).toEqual([loaded]);

    manager.delete(created.meta.id);
    expect(manager.listLoaded()).toHaveLength(0);
    expect(manager.listSummaries()).toHaveLength(0);
});

test("uses an updated working directory for relative shell commands", async () => {
    home.path = join(base, "cwd-home");
    const manager = new SessionManager();
    const firstDirectory = join(base, "cwd-first");
    const secondDirectory = join(base, "cwd-second");
    mkdirSync(firstDirectory, { recursive: true });
    mkdirSync(secondDirectory, { recursive: true });
    const session = manager.create(
        { workingDirectory: firstDirectory },
        "Working directory session",
        "full-access"
    );
    manager.updateContext(session.meta.id, {
        workingDirectory: secondDirectory
    });
    const nodePath = JSON.stringify(process.execPath);
    const script = JSON.stringify(
        "require('node:fs').writeFileSync('marker.txt', process.cwd())"
    );
    const command = process.platform === "win32"
        ? `& ${nodePath} -e ${script}`
        : `${nodePath} -e ${script}`;
    let calls = 0;
    const llm: LlmAdapter = {
        getModel: () => MODEL,
        stream(): AsyncIterable<LlmStreamEvent> {
            return (async function* (): AsyncIterable<LlmStreamEvent> {
                if (calls++ === 0) {
                    yield {
                        type: "done",
                        message: toolCallMessage(command)
                    };
                    return;
                }
                yield { type: "done", message: assistantMessage() };
            })();
        }
    };

    await session.request("create a marker", {
        llm,
        config: TEST_CONFIG,
        workingDirectories: [secondDirectory],
        emit: () => undefined
    });

    const toolResult = session.snapshot().messages.find(
        (message) => message.role === "toolResult"
    );
    expect(toolResult?.isError, toolResult?.content).toBe(false);
    expect(realpathSync.native(
        readFileSync(join(secondDirectory, "marker.txt"), "utf8").trim()
    )).toBe(realpathSync.native(secondDirectory));
    expect(existsSync(join(firstDirectory, "marker.txt"))).toBe(false);
});

test("uses an updated working directory for relative apply_patch paths", async () => {
    home.path = join(base, "patch-cwd-home");
    const manager = new SessionManager();
    const firstDirectory = join(base, "patch-cwd-first");
    const secondDirectory = join(base, "patch-cwd-second");
    mkdirSync(firstDirectory, { recursive: true });
    mkdirSync(secondDirectory, { recursive: true });
    const session = manager.create(
        { workingDirectory: firstDirectory },
        "Patch working directory session",
        "full-access"
    );
    manager.updateContext(session.meta.id, {
        workingDirectory: secondDirectory
    });
    let calls = 0;
    const llm: LlmAdapter = {
        getModel: () => MODEL,
        stream(): AsyncIterable<LlmStreamEvent> {
            return (async function* (): AsyncIterable<LlmStreamEvent> {
                if (calls++ === 0) {
                    yield {
                        type: "done",
                        message: applyPatchCallMessage()
                    };
                    return;
                }
                yield { type: "done", message: assistantMessage() };
            })();
        }
    };

    await session.request("create a nested file", {
        llm,
        config: TEST_CONFIG,
        workingDirectories: [secondDirectory],
        emit: () => undefined
    });

    const toolResult = session.snapshot().messages.find(
        (message) => message.role === "toolResult"
    );
    expect(toolResult?.isError, toolResult?.content).toBe(false);
    expect(readFileSync(join(secondDirectory, "nested", "marker.txt"), "utf8"))
        .toBe("created\n");
    expect(existsSync(join(firstDirectory, "nested", "marker.txt"))).toBe(false);
});

test("notifies an active request when its permission changes", async () => {
    home.path = join(base, "permission-home");
    const manager = new SessionManager();
    const session = manager.create({}, "Permission session");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const stream = vi.fn(() => (async function* (): AsyncIterable<LlmStreamEvent> {
        yield { type: "start" };
        await gate;
        yield { type: "done", message: assistantMessage() };
    })());

    const request = session.request("hello", {
        llm: { getModel: () => MODEL, stream },
        config: TEST_CONFIG,
        emit: () => undefined
    });

    await vi.waitFor(() => {
        expect(stream).toHaveBeenCalledTimes(1);
    });
    manager.updatePermission(session.meta.id, "full-access");
    release();
    await request;

    expect(session.meta.permission).toBe("full-access");
    expect(session.snapshot().messages.map((message) => message.role)).toEqual([
        "user",
        "assistant",
        "user"
    ]);
    expect(session.snapshot().messages.at(-1)).toMatchObject({
        context: "system-reminder",
        content: expect.stringContaining("permission: full-access")
    });
});

function fakeLlm(): LlmAdapter {
    return {
        getModel: () => MODEL,
        stream(): AsyncIterable<LlmStreamEvent> {
            return (async function* (): AsyncIterable<LlmStreamEvent> {
                yield { type: "done", message: assistantMessage() };
            })();
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
        timestamp: Date.now()
    };
}

function toolCallMessage(command: string): LlmAssistantMessage {
    return {
        ...assistantMessage(),
        content: [{
            type: "toolCall",
            id: "call-working-directory",
            name: "exec_command",
            arguments: {
                command,
                cwd: ".",
                timeoutMs: 10_000
            }
        }],
        stopReason: "toolUse"
    };
}

function applyPatchCallMessage(): LlmAssistantMessage {
    return {
        ...assistantMessage(),
        content: [{
            type: "toolCall",
            id: "call-patch-working-directory",
            name: APPLY_PATCH_TOOL,
            arguments: {
                patch: [
                    "*** Begin Patch",
                    "*** Add File: nested/marker.txt",
                    "+created",
                    "*** End Patch"
                ].join("\n"),
                cwd: "."
            }
        }],
        stopReason: "toolUse"
    };
}
