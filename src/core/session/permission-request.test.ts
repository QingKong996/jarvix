import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test, vi } from "vitest";
import type { LlmAdapter } from "../llm/index.ts";
import type {
    LlmAssistantMessage,
    LlmContentBlock,
    LlmModelInfo,
    LlmStopReason,
    LlmStreamEvent
} from "../../protocol/llm.ts";
import type { JarvixEvent } from "../../protocol/event.ts";
import { providerConfigSchema } from "../../protocol/providers.ts";
import { Jarvix } from "../index.ts";

const home = vi.hoisted(() => ({ path: "" }));

vi.mock("node:os", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:os")>();
    return { ...actual, homedir: () => home.path };
});

const base = mkdtempSync(join(tmpdir(), "jarvix-permission-request-"));

const MODEL: LlmModelInfo = {
    provider: "test",
    id: "test-model",
    name: "Test",
    reasoning: false,
    contextWindow: 1000,
    maxTokens: 100
};
const CONFIG = {
    providers: [providerConfigSchema.parse({
        id: MODEL.provider,
        name: MODEL.name,
        protocol: "openai-completions",
        baseUrl: "http://localhost:8080/v1",
        models: [{ id: MODEL.id, name: MODEL.name }]
    })],
    selectedModel: { provider: MODEL.provider, id: MODEL.id }
};

afterAll(() => {
    rmSync(base, { recursive: true, force: true });
});

test("approves access for the session and applies it to later tool calls", async () => {
    home.path = join(base, "home");
    const approvedDirectory = join(base, "approved");
    mkdirSync(approvedDirectory, { recursive: true });
    let turn = 0;
    const llm: LlmAdapter = {
        getModel: () => MODEL,
        stream: () => streamTurns(() => {
            turn += 1;
            if (turn === 1) {
                return [toolMessage([
                    toolCall("permission", "request_permission", {
                        domains: [{ action: "enable", domain: "api.example.com" }],
                        directories: [{
                            action: "enable",
                            access: "write",
                            path: approvedDirectory
                        }]
                    })
                ])];
            }
            if (turn === 2) {
                return [toolMessage([
                    toolCall("patch", "apply_patch", {
                        cwd: approvedDirectory,
                        patch: [
                            "*** Begin Patch",
                            "*** Add File: access.txt",
                            "+allowed",
                            "*** End Patch"
                        ].join("\n")
                    })
                ])];
            }
            return [assistantMessage("done")];
        })
    };
    const jarvix = new Jarvix({ llm, config: CONFIG });
    const session = jarvix.createSession({ workingDirectory: base }, "test", "read-only");
    const events: Array<{ type: string; [key: string]: unknown }> = [];
    let permissionRequestId = "";
    const unsubscribe = jarvix.subscribe((event, sessionId) => {
        events.push(event as unknown as { type: string; [key: string]: unknown });
        if (event.type === "permission.request") {
            permissionRequestId = event.request.id;
            expect(jarvix.respondPermission(sessionId, event.request.id, true)).toBe(true);
        }
    });

    try {
        await jarvix.request("allow access", session.meta.id);
    } finally {
        unsubscribe();
        await jarvix.shutdown();
    }

    expect(permissionRequestId).not.toBe("");
    expect(events.some((event) => event.type === "permission.resolved")).toBe(true);
    expect(events.find((event) =>
        event.type === "tool.end" && event.toolName === "request_permission"
    )?.data).toMatchObject({
        kind: "permission.request",
        decision: "approved"
    });
    expect(readFileSync(join(approvedDirectory, "access.txt"), "utf8")).toBe("allowed\n");
});

test("clears approved access when the permission mode changes", async () => {
    home.path = join(base, "permission-change-home");
    const workspace = join(base, "permission-change-workspace");
    const approvedDirectory = join(base, "permission-change-approved");
    mkdirSync(workspace, { recursive: true });
    mkdirSync(approvedDirectory, { recursive: true });
    let turn = 0;
    const llm: LlmAdapter = {
        getModel: () => MODEL,
        stream: () => streamTurns(() => {
            turn += 1;
            if (turn === 1) {
                return [toolMessage([
                    toolCall("grant", "request_permission", {
                        domains: [],
                        directories: [{
                            action: "enable",
                            access: "write",
                            path: approvedDirectory
                        }]
                    })
                ])];
            }
            if (turn === 2) {
                return [toolMessage([
                    toolCall("first-patch", "apply_patch", {
                        cwd: approvedDirectory,
                        patch: [
                            "*** Begin Patch",
                            "*** Add File: first.txt",
                            "+allowed",
                            "*** End Patch"
                        ].join("\n")
                    })
                ])];
            }
            if (turn === 4) {
                return [toolMessage([
                    toolCall("second-patch", "apply_patch", {
                        cwd: approvedDirectory,
                        patch: [
                            "*** Begin Patch",
                            "*** Add File: second.txt",
                            "+should not be written",
                            "*** End Patch"
                        ].join("\n")
                    })
                ])];
            }
            return [assistantMessage("done")];
        })
    };
    const jarvix = new Jarvix({ llm, config: CONFIG });
    const session = jarvix.createSession(
        { workingDirectory: workspace },
        "permission change",
        "auto-review"
    );
    const toolEnds: Array<Extract<JarvixEvent, { type: "tool.end" }>> = [];
    const unsubscribe = jarvix.subscribe((event, sessionId) => {
        if (event.type === "permission.request") {
            expect(jarvix.respondPermission(sessionId, event.request.id, true)).toBe(true);
        } else if (event.type === "tool.end") {
            toolEnds.push(event);
        }
    });

    try {
        await jarvix.request("allow access", session.meta.id);
        expect(readFileSync(join(approvedDirectory, "first.txt"), "utf8")).toBe("allowed\n");

        jarvix.setPermission(session.meta.id, "read-only");
        await jarvix.request("try again", session.meta.id);

        expect(toolEnds.find((event) => event.toolCallId === "second-patch")).toMatchObject({
            isError: true,
            data: { status: "failed" }
        });
        expect(existsSync(join(approvedDirectory, "second.txt"))).toBe(false);
    } finally {
        unsubscribe();
        await jarvix.shutdown();
    }
});

test("retains approved access across idle session release and reload", async () => {
    home.path = join(base, "permission-release-home");
    const approvedDirectory = join(base, "permission-release-approved");
    mkdirSync(approvedDirectory, { recursive: true });
    let turn = 0;
    let permissionRequests = 0;
    const llm: LlmAdapter = {
        getModel: () => MODEL,
        stream: () => streamTurns(() => {
            turn += 1;
            if (turn === 1) {
                return [toolMessage([
                    toolCall("grant", "request_permission", {
                        domains: [],
                        directories: [{
                            action: "enable",
                            access: "write",
                            path: approvedDirectory
                        }]
                    })
                ])];
            }
            if (turn === 3) {
                return [toolMessage([
                    toolCall("patch", "apply_patch", {
                        cwd: approvedDirectory,
                        patch: [
                            "*** Begin Patch",
                            "*** Add File: retained.txt",
                            "+still allowed",
                            "*** End Patch"
                        ].join("\n")
                    })
                ])];
            }
            return [assistantMessage("done")];
        })
    };
    const jarvix = new Jarvix({ llm, config: CONFIG });
    const session = jarvix.createSession({}, "retained permission", "read-only");
    const unsubscribe = jarvix.subscribe((event, sessionId) => {
        if (event.type === "permission.request") {
            permissionRequests += 1;
            expect(jarvix.respondPermission(sessionId, event.request.id, true)).toBe(true);
        }
    });

    try {
        await jarvix.request("grant access", session.meta.id);
        expect(permissionRequests).toBe(1);

        expect(jarvix.releaseSession(session.meta.id)).toBe(true);
        expect(jarvix.loadSession(session.meta.id)).not.toBeNull();

        await jarvix.request("use the retained grant", session.meta.id);

        expect(permissionRequests).toBe(1);
        expect(readFileSync(join(approvedDirectory, "retained.txt"), "utf8"))
            .toBe("still allowed\n");
    } finally {
        unsubscribe();
        await jarvix.shutdown();
    }
});

function streamTurns(next: () => LlmAssistantMessage[]): AsyncIterable<LlmStreamEvent> {
    return (async function* () {
        for (const message of next()) {
            yield { type: "start" };
            for (const [index, block] of message.content.entries()) {
                if (block.type === "text") {
                    yield { type: "text.start", index };
                    yield { type: "text.delta", index, delta: block.text };
                    yield { type: "text.end", index, text: block.text };
                } else if (block.type === "toolCall") {
                    yield { type: "toolCall.start", index };
                    yield { type: "toolCall.end", index, toolCall: block };
                }
            }
            yield { type: "done", message };
        }
    })();
}

function toolCall(
    id: string,
    name: string,
    arguments_: Record<string, unknown>
): LlmContentBlock {
    return { type: "toolCall", id, name, arguments: arguments_ };
}

function toolMessage(content: LlmContentBlock[]): LlmAssistantMessage {
    return assistantMessage("", "toolUse", content);
}

function assistantMessage(
    text: string,
    stopReason: LlmStopReason = "stop",
    content: LlmContentBlock[] = [{ type: "text", text }]
): LlmAssistantMessage {
    return {
        role: "assistant",
        content,
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
        stopReason,
        timestamp: Date.now()
    };
}
