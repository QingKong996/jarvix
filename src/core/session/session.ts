import type {
    LlmAdapter,
    LlmAssistantMessage,
    LlmMessage,
    LlmRequest,
    LlmSystemMessage,
    LlmSystemNotice,
    LlmToolCallBlock,
    LlmToolResultMessage,
    LlmUserMessage
} from "../../llm/index.ts";
import type { JarvixConfig } from "../../protocol/config.ts";
import type { JarvixEvent } from "../../protocol/event.ts";
import type { JarvixSession, JarvixSessionMeta } from "../../protocol/session.ts";
import {
    resolveConfiguredModel,
    resolveReasoningLevel
} from "../../protocol/providers.ts";
import {
    createDefaultTools,
    type ToolExecutionResult,
    type ToolExecutor
} from "../../tools/index.ts";
import { createToolCallViewData, toToolResultDetails, type ToolCallViewData } from "../../tools/view.ts";
import { appendSessionMessage } from "./store.ts";

const SYSTEM_PROMPT = `Respond to the user in Chinese. Current operating system: ${process.platform}.`;
const PERSIST_ATTEMPTS = 2;
export const MAX_TOOL_ROUNDS = 32;

type PendingPrompt = {
    id: string;
    text: string;
};

type TurnDecision = "continue" | "complete" | "failed";

type TurnContext = {
    runtime: SessionRuntime;
    signal: AbortSignal;
    request: Omit<LlmRequest, "messages" | "signal">;
};

export type SessionRuntime = {
    llm: LlmAdapter;
    config: JarvixConfig;
    workingDirectories?: readonly string[];
    emit(event: JarvixEvent): void;
};

/** In-memory state for one conversation. */
export class Session {
    readonly meta: JarvixSessionMeta;
    private readonly history: LlmMessage[];
    private readonly pendingPersistence: LlmMessage[] = [];
    private readonly pendingSystemMessages: LlmSystemMessage[] = [];
    private readonly pendingPrompts: PendingPrompt[] = [];
    private readonly backgroundExitNotices = new Set<string>();
    private readonly tools: ToolExecutor;
    private running = false;
    private toolUseOpen = false;
    private requestController: AbortController | null = null;

    constructor(
        meta: JarvixSessionMeta,
        messages: readonly LlmMessage[] = [],
        tools: ToolExecutor = createDefaultTools()
    ) {
        this.meta = meta;
        this.history = [...messages];
        this.tools = tools;
    }

    async request(question: string, runtime: SessionRuntime): Promise<void> {
        if (this.running) {
            throw new Error(`Session is busy: ${this.meta.id}`);
        }
        this.running = true;
        const controller = new AbortController();
        const { signal } = controller;
        this.requestController = controller;

        try {
            const resolved = resolveConfiguredModel(runtime.config.providers, runtime.config.selectedModel);
            if (!resolved) {
                throw new Error("No model configured");
            }
            const { selection, model: definition } = resolved;
            const provider = runtime.config.providers?.find((item) => item.id === selection.provider);
            const model = runtime.llm.getModel(selection.provider, selection.id);
            if (!model) {
                throw new Error(`Model not found: ${selection.provider}/${selection.id}`);
            }
            const turn: TurnContext = {
                runtime,
                signal,
                request: {
                    model,
                    systemPrompt: systemPromptFor(runtime.workingDirectories),
                    reasoning: resolveReasoningLevel(definition, runtime.config.reasoning),
                    apiKey: provider?.apiKey,
                    tools: this.tools.definitions
                }
            };

            const questionMessage: LlmUserMessage = {
                role: "user",
                content: question,
                timestamp: Date.now()
            };
            this.append(questionMessage);

            for (let round = 0; ;) {
                if (signal.aborted) {
                    break;
                }
                if (round >= MAX_TOOL_ROUNDS) {
                    throw new Error(`Tool call limit exceeded (${MAX_TOOL_ROUNDS})`);
                }

                const decision = await this.takeTurn(turn);
                if (signal.aborted || decision === "failed") {
                    break;
                }
                if (this.pendingPrompts.length > 0) {
                    this.insertPendingPrompts(runtime);
                    round = 0;
                    continue;
                }
                if (decision === "complete") {
                    break;
                }
                round += 1;
            }
        } catch (error) {
            if (signal.aborted) {
                return;
            }
            const reason = error instanceof Error ? error.message : String(error);
            runtime.emit({ type: "request.error", error: reason });
            throw error;
        } finally {
            this.toolUseOpen = false;
            this.flushPendingSystemMessages(runtime);
            this.pendingPrompts.length = 0;
            this.running = false;
            if (this.requestController === controller) {
                this.requestController = null;
            }
        }
    }

    abort(): void {
        this.pendingPrompts.length = 0;
        this.requestController?.abort();
    }

    injectPrompt(question: string, promptId: string): boolean {
        const text = question.trim();
        const id = promptId.trim();
        if (
            !this.running ||
            this.requestController?.signal.aborted ||
            text.length === 0 ||
            id.length === 0
        ) {
            return false;
        }
        this.pendingPrompts.push({ id, text });
        return true;
    }

    private async takeTurn(
        turn: TurnContext
    ): Promise<TurnDecision> {
        const { runtime, signal } = turn;
        if (signal.aborted) {
            return "failed";
        }

        let completed: LlmAssistantMessage | undefined;
        for await (const event of runtime.llm.stream({
            ...turn.request,
            messages: [...this.history],
            signal
        })) {
            if (signal.aborted) {
                break;
            }
            runtime.emit(event);
            if (event.type === "done") {
                completed = event.message;
                this.append(event.message);
                this.toolUseOpen = event.message.stopReason === "toolUse";
            } else if (event.type === "error") {
                completed = undefined;
            }
        }

        if (signal.aborted || !completed) {
            return "failed";
        }

        const toolCalls = completed.stopReason === "toolUse"
            ? completed.content.filter(
                (block): block is LlmToolCallBlock => block.type === "toolCall"
            )
            : [];
        if (toolCalls.length > 0) {
            try {
                for (const [index, toolCall] of toolCalls.entries()) {
                    if (signal.aborted) {
                        for (const remaining of toolCalls.slice(index)) {
                            this.finishCancelledToolCall(remaining, runtime);
                        }
                        break;
                    }
                    await this.executeToolCall(toolCall, runtime, signal);
                }
            } finally {
                this.toolUseOpen = false;
                this.flushPendingSystemMessages(runtime);
            }
        } else {
            this.toolUseOpen = false;
            this.flushPendingSystemMessages(runtime);
        }

        if (signal.aborted) {
            return "failed";
        }

        return toolCalls.length > 0 ? "continue" : "complete";
    }

    snapshot(): JarvixSession {
        return {
            meta: this.meta,
            messages: [...this.history]
        };
    }

    dispose(): void {
        this.abort();
        this.tools.dispose();
    }

    private async executeToolCall(
        toolCall: LlmToolCallBlock,
        runtime: SessionRuntime,
        signal: AbortSignal
    ): Promise<void> {
        if (signal.aborted) {
            this.finishCancelledToolCall(toolCall, runtime);
            return;
        }

        runtime.emit({
            type: "tool.start",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            data: createToolCallViewData(toolCall.name, toolCall.arguments, "running")
        });

        let result: ToolExecutionResult;
        if (!this.tools.handles(toolCall.name)) {
            result = failedToolResult(toolCall, `Unknown tool: ${toolCall.name}`);
        } else {
            try {
                result = await this.tools.execute(
                    toolCall,
                    {
                        onOutput: (data) => {
                            if (signal.aborted) {
                                return;
                            }
                            runtime.emit({
                                type: "tool.output",
                                toolCallId: toolCall.id,
                                toolName: toolCall.name,
                                data
                            });
                        },
                        onBackgroundEnd: ({ taskId, exitCode, error, unreadOutput, data, isError }) => {
                            runtime.emit({
                                type: "tool.end",
                                toolCallId: toolCall.id,
                                toolName: toolCall.name,
                                data,
                                isError,
                                endReason: "exited"
                            });
                            if (
                                !signal.aborted &&
                                unreadOutput.length > 0 &&
                                !this.backgroundExitNotices.has(taskId)
                            ) {
                                this.backgroundExitNotices.add(taskId);
                                this.queueBackgroundExitNotice(
                                    runtime,
                                    taskId,
                                    exitCode,
                                    error,
                                    unreadOutput.length
                                );
                            }
                        },
                        onTaskEvent: (event) => {
                            if (!signal.aborted) {
                                runtime.emit(event);
                            }
                        }
                    },
                    signal
                );
            } catch (error) {
                result = failedToolResult(toolCall, error instanceof Error ? error.message : String(error));
            }
        }

        this.completeToolCall(toolCall, result, runtime);
    }

    private finishCancelledToolCall(toolCall: LlmToolCallBlock, runtime: SessionRuntime): void {
        this.completeToolCall(
            toolCall,
            failedToolResult(toolCall, "Tool execution stopped."),
            runtime
        );
    }

    private completeToolCall(
        toolCall: LlmToolCallBlock,
        result: ToolExecutionResult,
        runtime: SessionRuntime
    ): void {
        runtime.emit({
            type: "tool.end",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            data: result.data,
            isError: result.isError,
            endReason: result.endReason
        });

        const message: LlmToolResultMessage = {
            role: "toolResult",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            content: result.content,
            details: toToolResultDetails(result.data),
            isError: result.isError,
            timestamp: Date.now()
        };
        this.append(message);
    }

    private queueBackgroundExitNotice(
        runtime: SessionRuntime,
        sessionId: string,
        exitCode: number | null,
        error: string | null,
        unreadCharacters: number
    ): void {
        const notice: LlmSystemNotice = {
            kind: "background.task_exit",
            sessionId,
            exitCode,
            errorMessage: error,
            unreadCharacters
        };
        const message: LlmSystemMessage = {
            role: "system",
            content: [
                `Background shell task ${sessionId} exited with code ${exitCode ?? "unknown"}.`,
                error ? `Error: ${error}` : null,
                `${unreadCharacters} characters of output are still buffered and unread.`,
                `Use write_stdin with sessionId ${sessionId} and an empty command to retrieve the buffer before continuing.`
            ].filter((line): line is string => line !== null).join("\n"),
            timestamp: Date.now(),
            notice
        };
        this.pendingSystemMessages.push(message);
        runtime.emit({ type: "system.message", message });
        this.flushPendingSystemMessages(runtime);
    }

    private insertPendingPrompts(runtime: SessionRuntime): void {
        while (this.pendingPrompts.length > 0) {
            const pending = this.pendingPrompts[0]!;
            const message: LlmUserMessage = {
                role: "user",
                content: pending.text,
                timestamp: Date.now()
            };
            this.append(message);
            this.pendingPrompts.shift();
            runtime.emit({
                type: "prompt.injected",
                promptId: pending.id,
                text: pending.text
            });
        }
    }

    private flushPendingSystemMessages(runtime: SessionRuntime): void {
        if (this.toolUseOpen) {
            return;
        }
        while (this.pendingSystemMessages.length > 0) {
            const message = this.pendingSystemMessages.shift()!;
            try {
                this.append(message);
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                runtime.emit({
                    type: "request.error",
                    error: `Failed to persist background notice: ${reason}`
                });
            }
        }
    }

    /** Update memory first, then flush the pending write queue in order. */
    private append(message: LlmMessage): void {
        this.history.push(message);
        this.pendingPersistence.push(message);
        this.flushPendingPersistence();
    }

    private flushPendingPersistence(): void {
        while (this.pendingPersistence.length > 0) {
            this.persist(this.pendingPersistence[0]!);
            this.pendingPersistence.shift();
        }
    }

    private persist(message: LlmMessage): void {
        let lastError: unknown;
        for (let attempt = 0; attempt < PERSIST_ATTEMPTS; attempt += 1) {
            try {
                appendSessionMessage(this.meta.id, message);
                return;
            } catch (error) {
                lastError = error;
            }
        }

        const reason = lastError instanceof Error ? lastError.message : String(lastError);
        throw new Error(
            `Failed to persist session ${this.meta.id} after ${PERSIST_ATTEMPTS} attempts: ${reason}`,
            { cause: lastError }
        );
    }
}

function systemPromptFor(workingDirectories: readonly string[] = []): string {
    if (workingDirectories.length === 0) {
        return SYSTEM_PROMPT;
    }
    return [
        SYSTEM_PROMPT,
        "",
        "Session working directories:",
        ...workingDirectories.map((directory) => `- ${directory}`),
        "Use one of these directories as cwd for shell commands and apply_patch when appropriate."
    ].join("\n");
}

function failedToolResult(toolCall: LlmToolCallBlock, output: string): ToolExecutionResult {
    const data: ToolCallViewData = {
        ...createToolCallViewData(toolCall.name, toolCall.arguments, "failed"),
        output
    };
    return {
        content: output,
        data,
        isError: true,
        endReason: "exited"
    };
}
