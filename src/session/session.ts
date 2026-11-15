import type {
    LlmAdapter,
    LlmAssistantMessage,
    LlmMessage,
    LlmSystemMessage,
    LlmSystemNotice,
    LlmToolCallBlock,
    LlmToolResultMessage,
    LlmUserMessage
} from "../llm/index.ts";
import type { JarvixConfig } from "../protocol/config.ts";
import type { JarvixEvent } from "../protocol/event.ts";
import type { JarvixSession, JarvixSessionMeta } from "../protocol/session.ts";
import {
    BackgroundTaskManager,
    type ToolExecutionResult,
    type ToolExecutor
} from "../tools/index.ts";
import { createToolCallViewData, toToolResultDetails, type ToolCallViewData } from "../tools/view.ts";
import { appendSessionMessage } from "./store.ts";
import {
    resolveConfiguredModel,
    resolveReasoningLevel
} from "../protocol/providers.ts";

const SYSTEM_PROMPT = `Response user in Chinese. Current operating system: ${process.platform}.`;
const PERSIST_ATTEMPTS = 2;
const MAX_TOOL_ROUNDS = 32;

export type SessionRuntime = {
    llm: LlmAdapter;
    config: JarvixConfig;
    emit(event: JarvixEvent): void;
};

/** In-memory state for one conversation. */
export class Session {
    readonly meta: JarvixSessionMeta;
    private readonly history: LlmMessage[];
    private readonly pendingPersistence: LlmMessage[] = [];
    private readonly pendingSystemMessages: LlmSystemMessage[] = [];
    private readonly backgroundExitNotices = new Set<string>();
    private readonly tools: ToolExecutor;
    private running = false;
    private toolUseOpen = false;

    constructor(
        meta: JarvixSessionMeta,
        messages: readonly LlmMessage[] = [],
        tools: ToolExecutor = new BackgroundTaskManager()
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

            const questionMessage: LlmUserMessage = {
                role: "user",
                content: question,
                timestamp: Date.now()
            };
            this.append(questionMessage);

            for (let round = 0; ; round += 1) {
                if (round >= MAX_TOOL_ROUNDS) {
                    throw new Error(`Tool call limit exceeded (${MAX_TOOL_ROUNDS})`);
                }

                const stream = runtime.llm.stream({
                    model,
                    messages: [...this.history],
                    systemPrompt: SYSTEM_PROMPT,
                    reasoning: resolveReasoningLevel(definition, runtime.config.reasoning),
                    apiKey: provider?.apiKey,
                    tools: this.tools.definitions
                });

                let completed: LlmAssistantMessage | undefined;
                for await (const event of stream) {
                    runtime.emit(event);
                    if (event.type === "done") {
                        completed = event.message;
                        this.append(event.message);
                        this.toolUseOpen = event.message.stopReason === "toolUse";
                    } else if (event.type === "error") {
                        completed = undefined;
                    }
                }

                if (completed?.stopReason !== "toolUse") {
                    break;
                }
                const toolCalls = completed.content.filter(
                    (block): block is LlmToolCallBlock => block.type === "toolCall"
                );
                if (toolCalls.length === 0) {
                    this.toolUseOpen = false;
                    this.flushPendingSystemMessages(runtime);
                    break;
                }
                try {
                    for (const toolCall of toolCalls) {
                        await this.executeToolCall(toolCall, runtime);
                    }
                } finally {
                    this.toolUseOpen = false;
                    this.flushPendingSystemMessages(runtime);
                }
            }
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            runtime.emit({ type: "request.error", error: reason });
            throw error;
        } finally {
            this.toolUseOpen = false;
            this.flushPendingSystemMessages(runtime);
            this.running = false;
        }
    }

    snapshot(): JarvixSession {
        return {
            meta: this.meta,
            messages: [...this.history]
        };
    }

    dispose(): void {
        this.tools.dispose();
    }

    private async executeToolCall(toolCall: LlmToolCallBlock, runtime: SessionRuntime): Promise<void> {
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
                    (data) => {
                        runtime.emit({
                            type: "tool.output",
                            toolCallId: toolCall.id,
                            toolName: toolCall.name,
                            data
                        });
                    },
                    undefined,
                    ({ taskId, exitCode, error, unreadOutput, data, isError }) => {
                        runtime.emit({
                            type: "tool.end",
                            toolCallId: toolCall.id,
                            toolName: toolCall.name,
                            data,
                            isError
                        });
                        if (unreadOutput.length > 0 && !this.backgroundExitNotices.has(taskId)) {
                            this.backgroundExitNotices.add(taskId);
                            this.queueBackgroundExitNotice(
                                runtime,
                                taskId,
                                exitCode,
                                error,
                                unreadOutput.length
                            );
                        }
                    }
                );
            } catch (error) {
                result = failedToolResult(toolCall, error instanceof Error ? error.message : String(error));
            }
        }

        runtime.emit({
            type: "tool.end",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            data: result.data,
            isError: result.isError
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

function failedToolResult(toolCall: LlmToolCallBlock, output: string): ToolExecutionResult {
    const data: ToolCallViewData = {
        ...createToolCallViewData(toolCall.name, toolCall.arguments, "failed"),
        output
    };
    return {
        content: output,
        data,
        isError: true
    };
}
