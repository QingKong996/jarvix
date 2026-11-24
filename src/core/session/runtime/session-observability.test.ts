import { expect, test, vi } from "vitest";
import type { LlmAdapter, LlmRequest } from "../../llm/index.ts";
import type {
    LlmAssistantMessage,
    LlmStreamEvent,
    LlmToolCallBlock
} from "../../../protocol/llm.ts";
import type { JarvixSessionMeta } from "../../../protocol/session.ts";
import type { ToolExecutor } from "../../../runtime/tools/index.ts";
import {
    noopAgentObserver,
    type AgentEvent,
    type AgentObserver,
    type AgentRunFinished,
    type AgentRunStarted,
    type AgentToolFinished,
    type AgentToolStarted,
    type AgentTurnFinished,
    type AgentTurnStarted
} from "../../observability/index.ts";
import { DEFAULT_PERMISSION_MODE } from "../../../protocol/permission.ts";
import { providerConfigSchema } from "../../../protocol/providers.ts";
import { Session } from "./session.ts";

vi.mock("../persistence/store.ts", () => ({
    appendSessionMessage: vi.fn(),
    appendSessionCompaction: vi.fn()
}));

const meta: JarvixSessionMeta = {
    type: "session",
    version: 1,
    id: "session-observability",
    name: "Observability",
    createdAt: 1,
    status: "active",
    permission: DEFAULT_PERMISSION_MODE
};
const MODEL = {
    provider: "test",
    id: "test-model",
    name: "Test",
    reasoning: false,
    contextWindow: 1_000,
    maxTokens: 100
};
const PROVIDER = providerConfigSchema.parse({
    id: "test",
    name: "Test",
    protocol: "openai-completions",
    baseUrl: "http://localhost:8080/v1",
    models: [{
        id: "test-model",
        name: "Test",
        contextWindow: 1_000,
        maxTokens: 100
    }]
});
const CONFIG = {
    providers: [PROVIDER],
    selectedModel: { provider: PROVIDER.id, id: "test-model" }
};

test("records structured prompt, turn, and tool telemetry", async () => {
    const toolCall: LlmToolCallBlock = {
        type: "toolCall",
        id: "call-1",
        name: "exec_command",
        arguments: { command: "echo secret-value" }
    };
    const firstMessage: LlmAssistantMessage = {
        role: "assistant",
        content: [toolCall],
        provider: MODEL.provider,
        model: MODEL.id,
        api: "test",
        usage: {
            inputTokens: 100,
            outputTokens: 20,
            cacheReadTokens: 5,
            cacheWriteTokens: 1,
            totalTokens: 126,
            cost: 0.001
        },
        stopReason: "toolUse",
        timestamp: 2,
        responseId: "response-1"
    };
    const secondMessage: LlmAssistantMessage = {
        ...firstMessage,
        content: [{ type: "text", text: "done" }],
        usage: {
            inputTokens: 200,
            outputTokens: 30,
            cacheReadTokens: 6,
            cacheWriteTokens: 2,
            totalTokens: 238,
            cost: 0.002
        },
        stopReason: "stop",
        responseId: "response-2"
    };
    let requestIndex = 0;
    const llm: LlmAdapter = {
        getModel: () => ({ ...MODEL }),
        stream(request: LlmRequest): AsyncIterable<LlmStreamEvent> {
            const response = requestIndex === 0 ? firstMessage : secondMessage;
            requestIndex += 1;
            return (async function* (): AsyncIterable<LlmStreamEvent> {
                request.onProviderRequest?.();
                request.onProviderResponse?.({
                    status: 429,
                    retryAfterMs: 50
                });
                request.onProviderRequest?.();
                request.onProviderResponse?.({ status: 200 });
                if (response === firstMessage) {
                    yield { type: "toolCall.start", index: 0 };
                } else {
                    yield { type: "text.delta", index: 0, delta: "done" };
                }
                await delay(5);
                yield { type: "done", message: response };
            })();
        }
    };
    const tools: ToolExecutor = {
        definitions: [{
            name: "exec_command",
            description: "Run a command",
            parameters: { type: "object", properties: {} }
        }],
        handles: (name) => name === "exec_command",
        execute: async () => {
            await delay(3);
            return {
                content: "ok",
                data: {
                    kind: "shell.exec_command",
                    command: "echo secret-value",
                    output: "ok",
                    status: "completed"
                },
                isError: false,
                endReason: "exited"
            };
        },
        stop: async () => [],
        dispose: () => undefined
    };
    const observer = recordingObserver();
    const session = new Session(
        meta,
        [],
        tools,
        undefined,
        undefined,
        undefined,
        observer
    );

    await session.request("do work", {
        llm,
        config: CONFIG,
        workingDirectories: [],
        emit: () => undefined
    });

    expect(observer.runsStarted).toHaveLength(1);
    expect(observer.runsStarted[0]).toMatchObject({
        runType: "prompt",
        sessionId: meta.id,
        provider: MODEL.provider,
        model: MODEL.id,
        permission: meta.permission,
        promptChars: 7,
        contextWindow: MODEL.contextWindow,
        maxRounds: 32,
        toolCount: 1
    });
    expect(observer.runsStarted[0]?.promptHash).toMatch(/^[a-f0-9]{16}$/);
    expect(observer.runsStarted[0]?.systemPromptHash).toMatch(/^[a-f0-9]{16}$/);
    expect(observer.runsStarted[0]?.toolsetHash).toMatch(/^[a-f0-9]{16}$/);

    expect(observer.turnsStarted).toHaveLength(2);
    expect(observer.turnsStarted.map((turn) => turn.turnIndex)).toEqual([0, 1]);
    expect(observer.turnsFinished[0]).toMatchObject({
        outcome: "completed",
        firstTokenKind: "toolCall",
        stopReason: "toolUse",
        toolCalls: 1,
        outputTokens: 20,
        llmHttpAttempts: 2,
        llmRetries: 1,
        rateLimitResponses: 1,
        retryAfterMs: 50,
        providerHttpStatus: 200
    });
    expect(observer.turnsFinished[1]).toMatchObject({
        outcome: "completed",
        firstTokenKind: "text",
        stopReason: "stop",
        toolCalls: 0,
        outputTokens: 30,
        llmHttpAttempts: 2,
        llmRetries: 1,
        rateLimitResponses: 1,
        retryAfterMs: 50,
        providerHttpStatus: 200
    });

    expect(observer.toolsStarted).toHaveLength(1);
    expect(observer.toolsStarted[0]).toMatchObject({
        toolName: "exec_command",
        toolCategory: "shell",
        turnIndex: 0
    });
    expect(observer.toolsStarted[0]?.argsHash).toMatch(/^[a-f0-9]{16}$/);
    expect(JSON.stringify(observer.toolsStarted[0])).not.toContain("secret-value");
    expect(observer.toolsFinished[0]).toMatchObject({
        outcome: "success",
        permissionRequests: 0,
        isError: false
    });
    expect(observer.toolsFinished[0]?.executionMs ?? 0).toBeGreaterThan(0);

    const finished = observer.runsFinished[0];
    expect(finished).toMatchObject({
        outcome: "completed",
        llmTurns: 2,
        agentSteps: 2,
        toolCalls: 1,
        toolErrors: 0,
        repeatToolCalls: 0,
        inputTokens: 300,
        outputTokens: 50,
        cacheReadTokens: 11,
        cacheWriteTokens: 3,
        finalStopReason: "stop",
        toolSequenceJson: "[\"exec_command\"]",
        llmHttpAttempts: 4,
        llmRetries: 2,
        rateLimitResponses: 2,
        retryAfterMs: 100,
        providerHttpStatus: 200
    });
    expect(finished?.ttftMs).not.toBeUndefined();
    expect(finished?.submitToFirstTokenMs).toBeGreaterThanOrEqual(0);
    expect(finished?.tokensPerSecond ?? 0).toBeGreaterThan(0);
    expect(finished?.unaccountedMs).toBeGreaterThanOrEqual(0);
    expect(observer.events).toEqual([]);

});

test("records a failed LLM stream with its error stage", async () => {
    const observer = recordingObserver();
    const session = new Session(
        meta,
        [],
        {
            definitions: [],
            handles: () => false,
            execute: async () => {
                throw new Error("unexpected tool call");
            },
            stop: async () => [],
            dispose: () => undefined
        },
        undefined,
        undefined,
        undefined,
        observer
    );
    const llm: LlmAdapter = {
        getModel: () => ({ ...MODEL }),
        stream: () => (async function* (): AsyncIterable<LlmStreamEvent> {
            yield { type: "text.delta", index: 0, delta: "partial" };
            throw new Error("429 Too Many Requests");
        })()
    };

    await expect(session.request("fail", {
        llm,
        config: CONFIG,
        workingDirectories: [],
        emit: () => undefined
    })).rejects.toThrow("429 Too Many Requests");

    expect(observer.turnsFinished[0]).toMatchObject({
        outcome: "error",
        errorCode: "llm_rate_limited",
        errorMessage: "429 Too Many Requests"
    });
    expect(observer.runsFinished[0]).toMatchObject({
        outcome: "failed",
        errorStage: "llm_stream",
        errorCode: "llm_rate_limited",
        errorMessage: "429 Too Many Requests",
        llmTurns: 1,
        agentSteps: 1,
        toolCalls: 0
    });
});

test("records an aborted run without classifying it as a failure", async () => {
    const observer = recordingObserver();
    const session = new Session(
        meta,
        [],
        {
            definitions: [],
            handles: () => false,
            execute: async () => {
                throw new Error("unexpected tool call");
            },
            stop: async () => [],
            dispose: () => undefined
        },
        undefined,
        undefined,
        undefined,
        observer
    );
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
        markStarted = resolve;
    });
    const llm: LlmAdapter = {
        getModel: () => ({ ...MODEL }),
        stream: (request: LlmRequest) => (async function* (): AsyncIterable<LlmStreamEvent> {
            yield { type: "start" };
            markStarted();
            await new Promise<void>((resolve) => {
                request.signal?.addEventListener("abort", () => resolve(), { once: true });
            });
        })()
    };

    const pending = session.request("abort me", {
        llm,
        config: CONFIG,
        workingDirectories: [],
        emit: () => undefined
    });
    await started;
    session.abort();
    await pending;

    expect(observer.turnsFinished[0]).toMatchObject({
        outcome: "aborted"
    });
    expect(observer.runsFinished[0]).toMatchObject({
        outcome: "aborted",
        llmTurns: 1,
        agentSteps: 1,
        toolCalls: 0
    });
    expect(observer.runsFinished[0]?.errorStage).toBeUndefined();
    expect(observer.events[0]).toMatchObject({
        event: "request.abort_requested",
        sessionId: meta.id,
        runId: observer.runsStarted[0]?.runId
    });
});

function recordingObserver(): AgentObserver & {
    runsStarted: AgentRunStarted[];
    runsFinished: AgentRunFinished[];
    turnsStarted: AgentTurnStarted[];
    turnsFinished: AgentTurnFinished[];
    toolsStarted: AgentToolStarted[];
    toolsFinished: AgentToolFinished[];
    events: AgentEvent[];
} {
    const runsStarted: AgentRunStarted[] = [];
    const runsFinished: AgentRunFinished[] = [];
    const turnsStarted: AgentTurnStarted[] = [];
    const turnsFinished: AgentTurnFinished[] = [];
    const toolsStarted: AgentToolStarted[] = [];
    const toolsFinished: AgentToolFinished[] = [];
    const events: AgentEvent[] = [];
    return {
        ...noopAgentObserver,
        runsStarted,
        runsFinished,
        turnsStarted,
        turnsFinished,
        toolsStarted,
        toolsFinished,
        events,
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
        },
        toolStarted: (tool) => {
            toolsStarted.push(tool);
        },
        toolFinished: (_toolSpanId, tool) => {
            toolsFinished.push(tool);
        },
        event: (event) => {
            events.push(event);
        }
    };
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
