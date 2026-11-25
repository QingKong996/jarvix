import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test, vi } from "vitest";
import type { LlmAdapter, LlmRequest } from "../../llm/adapter.ts";
import type {
    LlmAssistantMessage,
    LlmMessage,
    LlmModelInfo,
    LlmStreamEvent,
    LlmToolCallBlock,
    LlmToolDefinition
} from "../../../protocol/llm.ts";
import type { JarvixConfig } from "../../../protocol/config.ts";
import type { PermissionMode } from "../../../protocol/permission.ts";
import { providerConfigSchema } from "../../../protocol/providers.ts";
import type {
    ToolExecutionObserver,
    ToolExecutionResult,
    ToolExecutor
} from "../../../runtime/tools/types.ts";
import { createGenericToolCallViewData } from "../../../runtime/tools/tool-view.ts";
import { SessionPermissions } from "../../permissions/session-permissions.ts";
import { SESSION_FORMAT_VERSION } from "../persistence/records.ts";
import {
    GoalVerifier,
    VERIFY_RESULT_TOOL,
    type GoalVerificationInput
} from "./goal-verifier.ts";

const base = mkdtempSync(join(tmpdir(), "jarvix-goal-verifier-"));

const MODEL: LlmModelInfo = {
    provider: "test",
    id: "test-model",
    name: "Test",
    reasoning: false,
    contextWindow: 1_000,
    maxTokens: 100
};
const CONFIG: JarvixConfig = {
    providers: [providerConfigSchema.parse({
        id: MODEL.provider,
        name: MODEL.name,
        protocol: "openai-completions",
        baseUrl: "http://localhost:8080/v1",
        models: [{ id: MODEL.id, name: MODEL.name }]
    })],
    selectedModel: {
        provider: MODEL.provider,
        id: MODEL.id
    }
};

const EXEC_DEFINITION: LlmToolDefinition = {
    name: "exec_command",
    description: "Run a command",
    parameters: { type: "object", properties: {} }
};
const APPLY_PATCH_DEFINITION: LlmToolDefinition = {
    name: "apply_patch",
    description: "Patch a file",
    parameters: { type: "object", properties: {} }
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

function toolCall(
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

function scriptedLlm(
    steps: ReadonlyArray<() => LlmAssistantMessage>
): { llm: LlmAdapter; requests: LlmRequest[] } {
    const requests: LlmRequest[] = [];
    const queue = [...steps];
    const llm: LlmAdapter = {
        getModel: () => MODEL,
        stream(request) {
            requests.push({
                ...request,
                messages: [...request.messages]
            });
            const step = queue.shift();
            if (!step) {
                throw new Error("Unexpected verifier model call");
            }
            const message = step();
            return (async function* (): AsyncIterable<LlmStreamEvent> {
                yield { type: "start" };
                yield { type: "done", message };
            })();
        }
    };
    return { llm, requests };
}

function testTools() {
    const definitions = [EXEC_DEFINITION, APPLY_PATCH_DEFINITION];
    const execute = vi.fn(async (
        call: LlmToolCallBlock,
        _observer: ToolExecutionObserver,
        _signal?: AbortSignal
    ): Promise<ToolExecutionResult> => ({
        content: `ran:${call.name}`,
        data: createGenericToolCallViewData(
            call.name,
            call.arguments,
            "completed"
        ),
        isError: false,
        endReason: "exited"
    }));
    const getRegisteredTools = vi.fn((permission: PermissionMode) => (
        permission === "read-only"
            ? [EXEC_DEFINITION]
            : definitions
    ));
    const tools: ToolExecutor = {
        definitions,
        getRegisteredTools,
        handles: (name) => definitions.some((tool) => tool.name === name),
        execute,
        stop: async () => [],
        dispose: vi.fn()
    };
    return { tools, execute, getRegisteredTools };
}

function verificationInput(
    llm: LlmAdapter,
    tools: ToolExecutor,
    overrides: Partial<GoalVerificationInput> = {}
): GoalVerificationInput {
    return {
        sessionId: "session-1",
        goal: "Ship feature A",
        permission: "read-only",
        workingDirectories: [join(base, "workspace")],
        llm,
        config: CONFIG,
        tools,
        permissions: new SessionPermissions(),
        signal: new AbortController().signal,
        emit: vi.fn(),
        verifierDirectory: join(base, "transcripts"),
        ...overrides
    };
}

type TranscriptRecord = {
    type: string;
    version?: number;
    permission?: string;
    message?: LlmMessage;
};

function readTranscript(file: string): TranscriptRecord[] {
    return readFileSync(file, "utf8")
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line) as TranscriptRecord);
}

test("passes a decision using a fresh transcript and filtered tools", async () => {
    const { llm, requests } = scriptedLlm([
        () => toolCall(VERIFY_RESULT_TOOL, {
            passed: true,
            reason: "All checks pass."
        })
    ]);
    const { tools, execute, getRegisteredTools } = testTools();

    const result = await new GoalVerifier().verify(
        verificationInput(llm, tools)
    );

    expect(result).toMatchObject({
        passed: true,
        reason: "All checks pass.",
        verificationId: expect.stringContaining("session-1-"),
        file: expect.stringContaining(".jsonl")
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.messages.map((message) => message.role))
        .toEqual(["system", "user"]);
    expect(requests[0]?.messages[1]).toMatchObject({
        role: "user",
        content: "<goal>\nShip feature A\n</goal>"
    });
    expect(requests[0]?.systemPrompt).toContain("independent goal verifier");
    expect(requests[0]?.tools?.map((tool) => tool.name)).toEqual([
        "exec_command",
        VERIFY_RESULT_TOOL
    ]);
    expect(getRegisteredTools).toHaveBeenCalledWith("read-only");
    expect(execute).not.toHaveBeenCalled();

    const transcript = readTranscript(result.file);
    expect(transcript[0]).toMatchObject({
        type: "session",
        version: SESSION_FORMAT_VERSION,
        permission: "read-only"
    });
    expect(transcript.slice(1).map((record) => record.message?.role))
        .toEqual(["system", "user", "assistant", "toolResult"]);
    expect(transcript.at(-1)?.message).toMatchObject({
        role: "toolResult",
        toolName: VERIFY_RESULT_TOOL,
        content: "Verification recorded.",
        isError: false
    });
});

test.each([
    ["missing reason", { passed: true }, "requires a boolean passed and a string reason"],
    ["empty reason", { passed: true, reason: "   " }, "requires a non-empty reason"],
    ["wrong passed type", { passed: "yes", reason: "done" }, "requires a boolean passed"],
    [
        "unexpected field",
        { passed: true, reason: "done", summary: "completed" },
        "Unexpected fields: summary"
    ]
])("returns an invalid verify_result to the model: %s", async (
    _label,
    invalidArguments,
    expectedError
) => {
    const { llm, requests } = scriptedLlm([
        () => toolCall(VERIFY_RESULT_TOOL, invalidArguments),
        () => toolCall(VERIFY_RESULT_TOOL, {
            passed: true,
            reason: "Corrected decision."
        })
    ]);

    const result = await new GoalVerifier().verify(
        verificationInput(llm, testTools().tools)
    );

    expect(result.passed).toBe(true);
    expect(requests).toHaveLength(2);
    const toolResults = readTranscript(result.file)
        .map((record) => record.message)
        .filter((message) => message?.role === "toolResult");
    expect(toolResults[0]).toMatchObject({
        isError: true,
        content: expect.stringContaining(expectedError)
    });
    expect(toolResults[1]).toMatchObject({
        isError: false,
        content: "Verification recorded."
    });
});

test("does not execute a tool hidden by the current permission", async () => {
    const { llm, requests } = scriptedLlm([
        () => toolCall("apply_patch", { patch: "*** Begin Patch\n*** End Patch" }),
        () => toolCall(VERIFY_RESULT_TOOL, {
            passed: true,
            reason: "Verified after rejection."
        })
    ]);
    const { tools, execute } = testTools();

    const result = await new GoalVerifier().verify(
        verificationInput(llm, tools)
    );

    expect(result.passed).toBe(true);
    expect(requests[0]?.tools?.map((tool) => tool.name))
        .not.toContain("apply_patch");
    expect(execute).not.toHaveBeenCalled();
    expect(
        readTranscript(result.file)
            .map((record) => record.message)
            .find((message) => (
                message?.role === "toolResult" &&
                message.toolName === "apply_patch"
            ))
    ).toMatchObject({
        isError: true,
        content: expect.stringContaining("not available to the verifier")
    });
});

test("executes an available tool and returns its result to the model", async () => {
    const { llm, requests } = scriptedLlm([
        () => toolCall("exec_command", { command: "npm test" }),
        () => toolCall(VERIFY_RESULT_TOOL, {
            passed: true,
            reason: "Tests passed."
        })
    ]);
    const { tools, execute } = testTools();
    const controller = new AbortController();

    const result = await new GoalVerifier().verify(
        verificationInput(llm, tools, { signal: controller.signal })
    );

    expect(result.passed).toBe(true);
    expect(requests).toHaveLength(2);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
        name: "exec_command",
        arguments: { command: "npm test" }
    });
    expect(execute.mock.calls[0]?.[2]).toBe(controller.signal);
    expect(
        readTranscript(result.file)
            .map((record) => record.message)
            .find((message) => (
                message?.role === "toolResult" &&
                message.toolName === "exec_command"
            ))
    ).toMatchObject({
        content: "ran:exec_command",
        isError: false
    });
});

test("preserves a negative verification decision", async () => {
    const { llm } = scriptedLlm([
        () => toolCall(VERIFY_RESULT_TOOL, {
            passed: false,
            reason: "Tests are missing."
        })
    ]);

    const result = await new GoalVerifier().verify(
        verificationInput(llm, testTools().tools)
    );

    expect(result).toMatchObject({
        passed: false,
        reason: "Tests are missing."
    });
});

test("stops after repeated responses without verify_result", async () => {
    const { llm, requests } = scriptedLlm([
        () => assistantMessage("Still working."),
        () => assistantMessage("Still working."),
        () => assistantMessage("Still working.")
    ]);

    const result = await new GoalVerifier().verify(
        verificationInput(llm, testTools().tools)
    );

    expect(requests).toHaveLength(3);
    expect(result).toMatchObject({
        passed: false,
        reason: "Verifier did not call verify_result."
    });
});

test("returns a failure without calling the model when already aborted", async () => {
    const { llm, requests } = scriptedLlm([]);
    const controller = new AbortController();
    controller.abort();

    const result = await new GoalVerifier().verify(
        verificationInput(llm, testTools().tools, { signal: controller.signal })
    );

    expect(requests).toEqual([]);
    expect(result).toMatchObject({
        passed: false,
        reason: "Verification stopped."
    });
    expect(readTranscript(result.file).slice(1).map(
        (record) => record.message?.role
    )).toEqual(["system", "user"]);
});
