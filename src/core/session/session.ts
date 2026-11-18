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
import type { JarvixContextUsage } from "../../protocol/context-usage.ts";
import type { JarvixEvent } from "../../protocol/event.ts";
import type { JarvixProviderContext } from "../../protocol/provider-context.ts";
import type {
    PermissionDecision,
    PermissionGrantInput,
    PermissionMode
} from "../../protocol/permission.ts";
import type { JarvixSession, JarvixSessionMeta } from "../../protocol/session.ts";
import {
    resolveConfiguredModel,
    resolveReasoningLevel
} from "../../protocol/providers.ts";
import {
    createDefaultTools,
    type ToolExecutionResult,
    type ToolExecutor
} from "../tools/index.ts";
import { createToolCallViewData, toToolResultDetails, type ToolCallViewData } from "../tools/view.ts";
import { SessionPermissions } from "../permissions/session-permissions.ts";
import { estimateContextUsage } from "./context-usage.ts";
import {
    SYSTEM_PROMPT,
    environmentContextFor,
    environmentKeyFor,
    environmentReminderFor,
    isEnvironmentContextMessage
} from "./environment.ts";
import { appendSessionMessage } from "./store.ts";

const PERSIST_ATTEMPTS = 2;
export const MAX_TOOL_ROUNDS = 32;

type PendingPrompt = {
    type: "prompt";
    id: string;
    text: string;
};

type PendingSystemMessage = {
    type: "system";
    message: LlmSystemMessage;
};

type PendingEnvironmentReminder = {
    type: "environment";
};

type PendingTurnMessage = PendingPrompt | PendingSystemMessage | PendingEnvironmentReminder;

type TurnDecision = "continue" | "complete" | "failed";

type TurnContext = {
    runtime: SessionRuntime;
    signal: AbortSignal;
    contextWindow: number;
    request: Omit<LlmRequest, "messages" | "signal" | "tools">;
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
    private pendingTurnMessages: PendingTurnMessage[] = [];
    private readonly backgroundExitNotices = new Set<string>();
    private readonly tools: ToolExecutor;
    private readonly permissions: SessionPermissions;
    private readonly idleWaiters = new Set<() => void>();
    private running = false;
    private streamOpen = false;
    private toolUseOpen = false;
    private requestController: AbortController | null = null;
    private lastRuntime: SessionRuntime | null = null;
    private contextWindow: number | null = null;
    private environmentContextMessage: LlmSystemMessage | null = null;
    private environmentKey: string | null = null;
    private shutdownPromise: Promise<void> | null = null;

    constructor(
        meta: JarvixSessionMeta,
        messages: readonly LlmMessage[] = [],
        tools: ToolExecutor = createDefaultTools(),
        permissions: SessionPermissions = new SessionPermissions()
    ) {
        this.meta = meta;
        this.history = [...messages];
        const environmentContext = this.history.find(isEnvironmentContextMessage);
        if (environmentContext) {
            this.environmentContextMessage = environmentContext;
            this.environmentKey = environmentContext.environmentKey ?? null;
            this.history = [
                environmentContext,
                ...this.history.filter((message) => message !== environmentContext)
            ];
        }
        this.tools = tools;
        this.permissions = permissions;
    }

    async request(question: string, runtime: SessionRuntime): Promise<void> {
        if (this.running) {
            throw new Error(`Session is busy: ${this.meta.id}`);
        }
        this.running = true;
        this.lastRuntime = runtime;
        const controller = new AbortController();
        const { signal } = controller;
        this.requestController = controller;

        try {
            const resolved = resolveConfiguredModel(runtime.config.providers, runtime.config.selectedModel);
            if (!resolved) {
                throw new Error("No model configured");
            }
            const { selection, model: definition } = resolved;
            this.contextWindow = definition.contextWindow;
            const provider = runtime.config.providers?.find((item) => item.id === selection.provider);
            const model = runtime.llm.getModel(selection.provider, selection.id);
            if (!model) {
                throw new Error(`Model not found: ${selection.provider}/${selection.id}`);
            }
            const turn: TurnContext = {
                runtime,
                signal,
                contextWindow: definition.contextWindow,
                request: {
                    model,
                    systemPrompt: SYSTEM_PROMPT,
                    reasoning: resolveReasoningLevel(definition, runtime.config.reasoning),
                    apiKey: provider?.apiKey
                }
            };

            this.ensureEnvironmentContext(runtime);
            const questionMessage: LlmUserMessage = {
                role: "user",
                content: question,
                timestamp: Date.now()
            };
            this.append(questionMessage);
            const environmentReminder = this.appendEnvironmentReminderIfChanged(runtime);
            if (environmentReminder) {
                runtime.emit({ type: "system.message", message: environmentReminder });
            }
            this.emitContextUsage(turn);

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
                if (this.flushPendingTurnMessages(runtime)) {
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
            this.streamOpen = false;
            this.discardPendingPrompts();
            this.flushPendingSystemMessages(runtime);
            this.running = false;
            if (this.requestController === controller) {
                this.requestController = null;
            }
            this.notifyIdle();
        }
    }

    abort(): void {
        this.discardPendingPrompts();
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
        this.pendingTurnMessages.push({ type: "prompt", id, text });
        return true;
    }

    applyPermission(permission: PermissionMode): void {
        const previous = this.meta.permission;
        this.meta.permission = permission;
        if (
            previous === permission ||
            !this.running ||
            this.requestController?.signal.aborted
        ) {
            return;
        }
        if (!this.pendingTurnMessages.some((pending) => pending.type === "environment")) {
            this.pendingTurnMessages.push({ type: "environment" });
        }
    }

    respondPermission(requestId: string, decision: PermissionDecision): boolean {
        return this.permissions.respond(requestId, decision);
    }

    private async takeTurn(
        turn: TurnContext
    ): Promise<TurnDecision> {
        const { runtime, signal } = turn;
        if (signal.aborted) {
            return "failed";
        }

        let completed: LlmAssistantMessage | undefined;
        this.streamOpen = true;
        try {
            for await (const event of runtime.llm.stream({
                ...turn.request,
                tools: this.registeredTools(),
                messages: this.messagesForRequest(runtime.workingDirectories ?? []),
                signal
            })) {
                if (signal.aborted) {
                    break;
                }
                runtime.emit(event);
                if (event.type === "done") {
                    completed = event.message;
                    this.append(event.message);
                    this.emitContextUsage(turn);
                    this.toolUseOpen = event.message.stopReason === "toolUse";
                } else if (event.type === "error") {
                    completed = undefined;
                }
            }
        } finally {
            this.streamOpen = false;
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
                    this.emitContextUsage(turn);
                }
            } finally {
                this.toolUseOpen = false;
            }
        } else {
            this.toolUseOpen = false;
        }

        if (signal.aborted) {
            return "failed";
        }

        return toolCalls.length > 0 ? "continue" : "complete";
    }

    snapshot(): JarvixSession {
        return {
            meta: this.meta,
            messages: this.history.filter((message) => !isEnvironmentContextMessage(message))
        };
    }

    providerContext(workingDirectories: readonly string[] = []): JarvixProviderContext {
        return {
            systemPrompt: SYSTEM_PROMPT,
            messages: this.messagesForRequest(workingDirectories)
        };
    }

    contextUsage(
        contextWindow: number,
        workingDirectories: readonly string[] = []
    ): JarvixContextUsage {
        return estimateContextUsage({
            contextWindow,
            systemPrompt: SYSTEM_PROMPT,
            messages: this.messagesForRequest(workingDirectories),
            tools: this.registeredTools()
        });
    }

    shutdown(): Promise<void> {
        this.shutdownPromise ??= this.shutdownInternal();
        return this.shutdownPromise;
    }

    dispose(): void {
        this.abort();
        this.permissions.dispose();
        this.tools.dispose();
    }

    private async shutdownInternal(): Promise<void> {
        this.abort();
        await this.waitForIdle();
        try {
            const events = await this.tools.stop();
            if (this.lastRuntime) {
                for (const event of events) {
                    this.lastRuntime.emit(event);
                }
            }
        } finally {
            this.tools.dispose();
            this.lastRuntime = null;
        }
    }

    private waitForIdle(): Promise<void> {
        if (!this.running) {
            return Promise.resolve();
        }
        return new Promise((resolvePromise) => {
            this.idleWaiters.add(resolvePromise);
        });
    }

    private notifyIdle(): void {
        for (const resolvePromise of this.idleWaiters) {
            resolvePromise();
        }
        this.idleWaiters.clear();
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
                        },
                        requestPermission: (request) =>
                            this.requestSandboxPermission(request, runtime, signal)
                    },
                    signal
                );
            } catch (error) {
                result = failedToolResult(toolCall, error instanceof Error ? error.message : String(error));
            }
        }

        this.completeToolCall(toolCall, result, runtime);
    }

    private registeredTools() {
        return this.tools.getRegisteredTools?.(this.meta.permission) ?? this.tools.definitions;
    }

    private ensureEnvironmentContext(runtime: SessionRuntime): void {
        if (this.environmentContextMessage) {
            return;
        }
        const key = environmentKeyFor(
            this.meta.permission,
            runtime.workingDirectories
        );
        const message = this.createEnvironmentContext(runtime.workingDirectories ?? [], key);
        this.history.unshift(message);
        this.environmentContextMessage = message;
        this.environmentKey = key;
    }

    private messagesForRequest(workingDirectories: readonly string[]): LlmMessage[] {
        const key = environmentKeyFor(this.meta.permission, workingDirectories);
        if (!this.environmentContextMessage) {
            return [
                this.createEnvironmentContext(workingDirectories, key),
                ...this.history
            ];
        }

        const messages = [...this.history];
        if (this.environmentKey !== key) {
            messages.push(
                environmentReminderFor(this.meta.permission, workingDirectories).persisted
            );
        }
        return messages;
    }

    private createEnvironmentContext(
        workingDirectories: readonly string[],
        key: string
    ): LlmSystemMessage {
        return {
            ...environmentContextFor(this.meta.permission, workingDirectories),
            context: "environment",
            environmentKey: key
        };
    }

    private appendEnvironmentReminderIfChanged(
        runtime: SessionRuntime
    ): LlmSystemMessage | null {
        const key = environmentKeyFor(this.meta.permission, runtime.workingDirectories);
        if (key === this.environmentKey) {
            return null;
        }

        const reminder = environmentReminderFor(
            this.meta.permission,
            runtime.workingDirectories
        );
        this.environmentKey = key;
        this.append(reminder.persisted);
        return reminder.display;
    }

    private emitContextUsage(turn: TurnContext): void {
        this.emitContextUsageFor(turn.runtime, turn.contextWindow);
    }

    private emitContextUsageFor(
        runtime: SessionRuntime,
        contextWindow: number | null
    ): void {
        if (contextWindow === null) {
            return;
        }
        runtime.emit({
            type: "context.usage",
            usage: this.contextUsage(contextWindow, runtime.workingDirectories)
        });
    }

    private async requestSandboxPermission(
        input: PermissionGrantInput,
        runtime: SessionRuntime,
        signal: AbortSignal
    ): Promise<PermissionDecision> {
        if (signal.aborted) {
            return "cancelled";
        }
        const handle = this.permissions.begin(input, signal);
        runtime.emit({
            type: "permission.request",
            request: handle.request
        });
        const decision = await handle.decision;
        runtime.emit({
            type: "permission.resolved",
            requestId: handle.request.id,
            decision
        });
        return decision;
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
        this.pendingTurnMessages.push({ type: "system", message });
        this.flushPendingSystemMessages(runtime);
    }

    private flushPendingTurnMessages(runtime: SessionRuntime): boolean {
        let injectedPrompt = false;
        while (this.pendingTurnMessages.length > 0) {
            const pending = this.pendingTurnMessages.shift()!;
            if (pending.type === "prompt") {
                injectedPrompt = true;
                this.insertPrompt(pending, runtime);
            } else if (pending.type === "environment") {
                this.insertEnvironmentReminder(runtime);
            } else {
                this.insertSystemMessage(pending, runtime);
            }
        }
        return injectedPrompt;
    }

    private insertPrompt(pending: PendingPrompt, runtime: SessionRuntime): void {
        const message: LlmUserMessage = {
            role: "user",
            content: pending.text,
            timestamp: Date.now()
        };
        this.append(message);
        this.emitContextUsageFor(runtime, this.contextWindow);
        runtime.emit({
            type: "prompt.injected",
            promptId: pending.id,
            text: pending.text
        });
    }

    private insertSystemMessage(
        pending: PendingSystemMessage,
        runtime: SessionRuntime
    ): void {
        try {
            this.append(pending.message);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            runtime.emit({
                type: "request.error",
                error: `Failed to persist system message: ${reason}`
            });
            return;
        }
        this.emitContextUsageFor(runtime, this.contextWindow);
        runtime.emit({ type: "system.message", message: pending.message });
    }

    private insertEnvironmentReminder(runtime: SessionRuntime): void {
        const reminder = this.appendEnvironmentReminderIfChanged(runtime);
        if (!reminder) {
            return;
        }
        this.emitContextUsageFor(runtime, this.contextWindow);
        runtime.emit({ type: "system.message", message: reminder });
    }

    private discardPendingPrompts(): void {
        this.pendingTurnMessages = this.pendingTurnMessages.filter(
            (pending) => pending.type !== "prompt"
        );
    }

    private flushPendingSystemMessages(runtime: SessionRuntime): void {
        if (this.streamOpen || this.toolUseOpen) {
            return;
        }
        while (true) {
            const pending = this.pendingTurnMessages[0];
            if (!pending || pending.type === "prompt") {
                break;
            }
            this.pendingTurnMessages.shift();
            if (pending.type === "environment") {
                this.insertEnvironmentReminder(runtime);
            } else {
                this.insertSystemMessage(pending, runtime);
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
        isError: true,
        endReason: "exited"
    };
}
