import type {
    LlmAssistantMessage,
    LlmMessage,
    LlmRequest,
    LlmSystemMessage,
    LlmSystemNotice,
    LlmToolCallBlock,
    LlmToolResultMessage,
    LlmUserMessage
} from "../../../llm/index.ts";
import type { JarvixContextUsage } from "../../../protocol/context-usage.ts";
import type { JarvixProviderContext } from "../../../protocol/provider-context.ts";
import type {
    PermissionDecision,
    PermissionMode
} from "../../../protocol/permission.ts";
import type { JarvixSession, JarvixSessionMeta } from "../../../protocol/session.ts";
import {
    resolveConfiguredModel,
    resolveReasoningLevel
} from "../../../protocol/providers.ts";
import {
    createDefaultTools,
    type ToolExecutor
} from "../../tools/index.ts";
import { SessionPermissions } from "../../permissions/session-permissions.ts";
import { estimateContextUsage } from "./context-usage.ts";
import { SYSTEM_PROMPT, isEnvironmentContextMessage } from "./environment.ts";
import { SessionEnvironmentContext } from "./environment-context.ts";
import {
    PendingMessageQueue,
    type PendingPrompt,
    type PendingSystemMessage
} from "./pending-messages.ts";
import { SessionPersistenceQueue } from "./persistence-queue.ts";
import { ToolCallRunner } from "./tool-runner.ts";
import type { SessionRuntime } from "./types.ts";

export const MAX_TOOL_ROUNDS = 32;
export const SHUTDOWN_TIMEOUT_MS = 10_000;
export type { SessionRuntime } from "./types.ts";

type TurnDecision = "continue" | "complete" | "failed";

type TurnContext = {
    runtime: SessionRuntime;
    signal: AbortSignal;
    contextWindow: number;
    request: Omit<LlmRequest, "messages" | "signal" | "tools">;
};

/** In-memory state for one conversation. */
export class Session {
    readonly meta: JarvixSessionMeta;
    private readonly history: LlmMessage[];
    private readonly persistence: SessionPersistenceQueue;
    private readonly pendingMessages = new PendingMessageQueue();
    private readonly environment: SessionEnvironmentContext;
    private readonly toolRunner: ToolCallRunner;
    private readonly permissions: SessionPermissions;
    private readonly idleWaiters = new Set<() => void>();
    private running = false;
    private streamOpen = false;
    private toolUseOpen = false;
    private requestController: AbortController | null = null;
    private lastRuntime: SessionRuntime | null = null;
    private contextWindow: number | null = null;
    private shutdownPromise: Promise<void> | null = null;

    constructor(
        meta: JarvixSessionMeta,
        messages: readonly LlmMessage[] = [],
        tools: ToolExecutor = createDefaultTools(),
        permissions: SessionPermissions = new SessionPermissions()
    ) {
        this.meta = meta;
        this.environment = new SessionEnvironmentContext(() => this.meta.permission);
        this.history = this.environment.initialize(messages);
        this.permissions = permissions;
        this.persistence = new SessionPersistenceQueue(meta.id);
        this.toolRunner = new ToolCallRunner({
            tools,
            permissions,
            append: (message) => this.append(message),
            queueBackgroundExitNotice: (runtime, sessionId, exitCode, error, unreadCharacters) => {
                this.queueBackgroundExitNotice(
                    runtime,
                    sessionId,
                    exitCode,
                    error,
                    unreadCharacters
                );
            }
        });
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
            this.contextWindow = definition.contextWindow;
            const turn: TurnContext = {
                runtime,
                signal,
                contextWindow: definition.contextWindow,
                request: {
                    model,
                    systemPrompt: SYSTEM_PROMPT,
                    reasoning: resolveReasoningLevel(definition, runtime.config.reasoning),
                    apiKey: provider?.apiKey,
                    maxTokens: definition.maxTokens
                }
            };

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
            this.pendingMessages.discardPrompts();
            this.flushPendingSystemMessages(runtime);
            this.running = false;
            if (this.requestController === controller) {
                this.requestController = null;
            }
            this.notifyIdle();
        }
    }

    abort(): void {
        this.pendingMessages.discardPrompts();
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
        this.pendingMessages.addPrompt(id, text);
        return true;
    }

    applyPermission(permission: PermissionMode): void {
        const previous = this.meta.permission;
        this.meta.permission = permission;
        if (previous === permission) {
            return;
        }
        this.permissions.reset();
        if (!this.running || this.requestController?.signal.aborted) {
            return;
        }
        if (!this.pendingMessages.hasEnvironmentReminder()) {
            this.pendingMessages.addEnvironmentReminder();
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
        let streamErrorReported = false;
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
                    streamErrorReported = true;
                }
            }
        } finally {
            this.streamOpen = false;
        }

        if (signal.aborted) {
            return "failed";
        }
        if (!completed && !streamErrorReported) {
            throw new Error("Model response ended without a completion event");
        }
        if (!completed) {
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
                            this.toolRunner.cancel(remaining, runtime);
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

    canRelease(): boolean {
        return !this.running
            && !this.streamOpen
            && !this.toolUseOpen
            && this.requestController === null
            && this.pendingMessages.length === 0
            && this.persistence.pendingCount === 0
            && !this.permissions.hasPending()
            && !this.toolRunner.hasActiveWork;
    }

    release(): boolean {
        if (!this.canRelease()) {
            return false;
        }
        this.toolRunner.dispose();
        this.lastRuntime = null;
        return true;
    }

    shutdown(timeoutMs = SHUTDOWN_TIMEOUT_MS): Promise<void> {
        this.shutdownPromise ??= this.shutdownWithinDeadline(timeoutMs);
        return this.shutdownPromise;
    }

    dispose(): void {
        this.abort();
        this.permissions.dispose();
        this.toolRunner.dispose();
    }

    private async shutdownWithinDeadline(timeoutMs: number): Promise<void> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const deadline = new Promise<false>((resolvePromise) => {
            timer = setTimeout(() => resolvePromise(false), timeoutMs);
        });
        try {
            const completed = await Promise.race([
                this.shutdownInternal().then(() => true as const),
                deadline
            ]);
            if (completed) {
                return;
            }
            this.toolRunner.dispose();
            this.lastRuntime = null;
        } finally {
            clearTimeout(timer);
        }
    }

    private async shutdownInternal(): Promise<void> {
        this.abort();
        await this.waitForIdle();
        try {
            const events = await this.toolRunner.stop();
            if (this.lastRuntime) {
                for (const event of events) {
                    this.lastRuntime.emit(event);
                }
            }
        } finally {
            this.toolRunner.dispose();
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
        await this.toolRunner.execute(toolCall, runtime, signal);
    }

    private registeredTools() {
        return this.toolRunner.registeredTools(this.meta.permission);
    }

    private ensureEnvironmentContext(runtime: SessionRuntime): void {
        const message = this.environment.ensure(runtime.workingDirectories);
        if (message) {
            this.history.unshift(message);
        }
    }

    private messagesForRequest(workingDirectories: readonly string[]): LlmMessage[] {
        return this.environment.messagesFor(this.history, workingDirectories);
    }

    private appendEnvironmentReminderIfChanged(
        runtime: SessionRuntime
    ): LlmSystemMessage | null {
        const reminder = this.environment.reminderIfChanged(runtime.workingDirectories);
        if (!reminder) {
            return null;
        }
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
        this.pendingMessages.addSystemMessage(message);
        this.flushPendingSystemMessages(runtime);
    }

    private flushPendingTurnMessages(runtime: SessionRuntime): boolean {
        return this.pendingMessages.flush({
            insertPrompt: (pending) => this.insertPrompt(pending, runtime),
            insertEnvironment: () => this.insertEnvironmentReminder(runtime),
            insertSystem: (pending) => this.insertSystemMessage(pending, runtime)
        });
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

    private flushPendingSystemMessages(runtime: SessionRuntime): void {
        this.pendingMessages.flushSystemMessages({
            insertPrompt: (pending) => this.insertPrompt(pending, runtime),
            insertEnvironment: () => this.insertEnvironmentReminder(runtime),
            insertSystem: (pending) => this.insertSystemMessage(pending, runtime)
        }, this.streamOpen || this.toolUseOpen);
    }

    /** Update memory first, then flush the pending write queue in order. */
    private append(message: LlmMessage): void {
        this.history.push(message);
        this.persistence.enqueue(message);
    }
}
