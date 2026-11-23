import type {
    LlmAssistantMessage,
    LlmMessage,
    LlmSystemMessage,
    LlmSystemNotice,
    LlmToolCallBlock,
    LlmUserMessage
} from "../../../protocol/llm.ts";
import type { LlmRequest } from "../../llm/index.ts";
import type { JarvixContextUsage } from "../../../protocol/context-usage.ts";
import type { JarvixProviderContext } from "../../../protocol/provider-context.ts";
import type {
    PermissionDecision,
    PermissionMode
} from "../../../protocol/permission.ts";
import type { JarvixSession, JarvixSessionMeta } from "../../../protocol/session.ts";
import { type JarvixLogger, noopLogger } from "../../logger.ts";
import {
    resolveConfiguredModel,
    resolveReasoningLevel
} from "../../../protocol/providers.ts";
import {
    type ToolManager,
    type ToolExecutor
} from "../../../runtime/tools/index.ts";
import { createDefaultTools } from "../../../runtime/tools/index.ts";
import { SessionPermissions } from "../../permissions/session-permissions.ts";
import {
    createDefaultContextManager,
    type ContextManager,
    type ContextManagerFactory
} from "./context-manager.ts";
import {
    CONTEXT_COMPACTION_BLOCK_TOKENS,
    CONTEXT_COMPACTION_SYSTEM_PROMPT,
    compactBlockContent,
    compactionPromptFor,
    contextCompactionTriggerTokens,
    selectCompactionRange
} from "./context-compaction.ts";
import {
    PendingMessageQueue,
    type PendingPrompt,
    type PendingSystemMessage
} from "./pending-messages.ts";
import { SessionPersistenceQueue } from "./persistence-queue.ts";
import { ToolCallRunner } from "./tool-runner.ts";
import type { SessionRuntime } from "./types.ts";

export const MAX_TOOL_ROUNDS = 32;
const SHUTDOWN_TIMEOUT_MS = 10_000;
const MAX_CONTEXT_COMPACTION_ATTEMPTS = 8;
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
    private readonly contextManager: ContextManager;
    private readonly toolRunner: ToolCallRunner;
    private readonly permissions: SessionPermissions;
    private readonly logger: JarvixLogger;
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
        permissions: SessionPermissions = new SessionPermissions(),
        contextManagerFactory: ContextManagerFactory = createDefaultContextManager,
        logger: JarvixLogger = noopLogger
    ) {
        this.meta = meta;
        this.logger = logger;
        this.contextManager = contextManagerFactory(() => this.meta.permission);
        this.history = this.contextManager.initializeHistory(messages);
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
            },
            sessionId: meta.id,
            logger
        });
    }

    async request(question: string, runtime: SessionRuntime): Promise<void> {
        if (this.running) {
            this.logger.warn("Rejected request because the session is busy", {
                sessionId: this.meta.id
            });
            throw new Error(`Session is busy: ${this.meta.id}`);
        }
        const startedAt = performance.now();
        let failed = false;
        this.running = true;
        this.lastRuntime = runtime;
        const controller = new AbortController();
        const { signal } = controller;
        this.requestController = controller;
        this.logger.info("Session request started", {
            sessionId: this.meta.id,
            promptLength: question.length,
            permission: this.meta.permission
        });

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
            this.logger.debug("Session request resolved model", {
                sessionId: this.meta.id,
                provider: selection.provider,
                model: selection.id,
                reasoning: runtime.config.reasoning,
                messageCount: this.history.length
            });
            const turn: TurnContext = {
                runtime,
                signal,
                contextWindow: definition.contextWindow,
                request: {
                    model,
                    systemPrompt: this.contextManager.systemPrompt,
                    reasoning: resolveReasoningLevel(definition, runtime.config.reasoning),
                    apiKey: provider?.apiKey,
                    maxTokens: definition.maxTokens
                }
            };

            await this.compactContextIfNeeded(turn);
            this.emitContextUsage(turn);

            for (let round = 0; ;) {
                if (signal.aborted) {
                    break;
                }
                if (round >= MAX_TOOL_ROUNDS) {
                    throw new Error(`Tool call limit exceeded (${MAX_TOOL_ROUNDS})`);
                }

                await this.compactContextIfNeeded(turn);
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
            failed = true;
            const reason = error instanceof Error ? error.message : String(error);
            this.logger.error("Session request failed", error, {
                sessionId: this.meta.id,
                durationMs: elapsedMs(startedAt)
            });
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
            this.logger.info("Session request finished", {
                sessionId: this.meta.id,
                durationMs: elapsedMs(startedAt),
                outcome: signal.aborted ? "aborted" : failed ? "failed" : "completed"
            });
        }
    }

    abort(): void {
        this.pendingMessages.discardPrompts();
        if (this.running) {
            this.logger.info("Aborting session request", {
                sessionId: this.meta.id
            });
        }
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
            this.logger.debug("Ignored prompt injection", {
                sessionId: this.meta.id,
                promptId
            });
            return false;
        }
        this.pendingMessages.addPrompt(id, text);
        this.logger.debug("Queued injected prompt", {
            sessionId: this.meta.id,
            promptId: id,
            promptLength: text.length
        });
        return true;
    }

    applyPermission(permission: PermissionMode): void {
        const previous = this.meta.permission;
        this.meta.permission = permission;
        if (previous === permission) {
            return;
        }
        this.logger.info("Session permission changed", {
            sessionId: this.meta.id,
            previous,
            permission
        });
        this.permissions.reset();
        if (!this.running || this.requestController?.signal.aborted) {
            return;
        }
        if (!this.pendingMessages.hasEnvironmentReminder()) {
            this.pendingMessages.addEnvironmentReminder();
        }
    }

    respondPermission(requestId: string, decision: PermissionDecision): boolean {
        const accepted = this.permissions.respond(requestId, decision);
        this.logger.info("Permission response received", {
            sessionId: this.meta.id,
            requestId,
            decision,
            accepted
        });
        return accepted;
    }

    registerToolManager(manager: ToolManager): void {
        this.toolRunner.registerToolManager(manager);
    }

    async unregisterToolManager(managerId: string): Promise<void> {
        await this.toolRunner.unregisterToolManager(managerId);
    }

    private async takeTurn(
        turn: TurnContext
    ): Promise<TurnDecision> {
        const { runtime, signal } = turn;
        if (signal.aborted) {
            return "failed";
        }

        const streamStartedAt = performance.now();
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
                    this.logger.warn("Model stream returned an error", {
                        sessionId: this.meta.id,
                        provider: event.message.provider,
                        model: event.message.model,
                        error: event.message.errorMessage
                    });
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
        this.logger.debug("Model response received", {
            sessionId: this.meta.id,
            provider: completed.provider,
            model: completed.model,
            stopReason: completed.stopReason,
            toolCallCount: toolCalls.length,
            inputTokens: completed.usage.inputTokens,
            outputTokens: completed.usage.outputTokens,
            cacheReadTokens: completed.usage.cacheReadTokens,
            durationMs: elapsedMs(streamStartedAt)
        });
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
            messages: this.contextManager.visibleHistory(this.history)
        };
    }

    providerContext(workingDirectories: readonly string[] = []): JarvixProviderContext {
        return this.contextManager.prepareRequest(this.history, workingDirectories);
    }

    contextUsage(
        contextWindow: number,
        workingDirectories: readonly string[] = []
    ): JarvixContextUsage {
        return this.contextManager.estimateUsage({
            contextWindow,
            history: this.history,
            workingDirectories,
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
        this.logger.info("Session shutdown started", {
            sessionId: this.meta.id,
            timeoutMs
        });
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
                this.logger.info("Session shutdown finished", {
                    sessionId: this.meta.id
                });
                return;
            }
            this.logger.warn("Session shutdown timed out", {
                sessionId: this.meta.id,
                timeoutMs
            });
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
        const message = this.contextManager.ensureEnvironmentContext(
            runtime.workingDirectories
        );
        if (message) {
            this.history.unshift(message);
        }
    }

    private messagesForRequest(workingDirectories: readonly string[]): LlmMessage[] {
        return this.contextManager.prepareRequest(
            this.history,
            workingDirectories
        ).messages;
    }

    private appendEnvironmentReminderIfChanged(
        runtime: SessionRuntime
    ): LlmSystemMessage | null {
        const reminder = this.contextManager.environmentReminderIfChanged(
            runtime.workingDirectories
        );
        if (!reminder) {
            return null;
        }
        this.append(reminder.persisted);
        return reminder.display;
    }

    private emitContextUsage(turn: TurnContext): void {
        this.emitContextUsageFor(turn.runtime, turn.contextWindow);
    }

    private async compactContextIfNeeded(turn: TurnContext): Promise<void> {
        for (
            let attempt = 0;
            attempt < MAX_CONTEXT_COMPACTION_ATTEMPTS;
            attempt += 1
        ) {
            if (turn.signal.aborted) {
                return;
            }
            const usage = this.contextUsage(
                turn.contextWindow,
                turn.runtime.workingDirectories ?? []
            );
            const triggerTokens = contextCompactionTriggerTokens(
                turn.contextWindow,
                turn.runtime.config.contextCompactionThreshold
            );
            if (usage.estimatedTokens <= triggerTokens) {
                return;
            }
            const selection = selectCompactionRange(
                this.history,
                usage.estimatedTokens,
                triggerTokens
            );
            if (!selection) {
                return;
            }

            const selected = this.history.slice(selection.start, selection.end);
            const startedAt = performance.now();
            this.logger.info("Context compaction started", {
                sessionId: this.meta.id,
                selectedMessageCount: selected.length,
                estimatedTokens: usage.estimatedTokens,
                triggerTokens
            });
            const summary = await this.generateCompactionSummary(selected, turn);
            if (turn.signal.aborted) {
                return;
            }
            const message: LlmUserMessage = {
                role: "user",
                content: compactBlockContent(summary),
                context: "compact",
                timestamp: Date.now()
            };
            this.history.splice(
                selection.start,
                selection.end - selection.start,
                message
            );
            this.persistence.enqueueCompaction(message, selected);
            this.emitContextUsageFor(turn.runtime, turn.contextWindow);
            this.logger.info("Context compaction completed", {
                sessionId: this.meta.id,
                compactedMessageCount: selected.length,
                durationMs: elapsedMs(startedAt)
            });
        }
    }

    private async generateCompactionSummary(
        messages: readonly LlmMessage[],
        turn: TurnContext
    ): Promise<string> {
        let completed: LlmAssistantMessage | undefined;
        const request = {
            ...turn.request,
            systemPrompt: CONTEXT_COMPACTION_SYSTEM_PROMPT,
            messages: [{
                role: "user" as const,
                content: compactionPromptFor(messages),
                timestamp: Date.now()
            }],
            tools: [],
            temperature: 0,
            maxTokens: Math.min(
                CONTEXT_COMPACTION_BLOCK_TOKENS,
                turn.request.maxTokens ?? CONTEXT_COMPACTION_BLOCK_TOKENS
            ),
            signal: turn.signal
        };

        for await (const event of turn.runtime.llm.stream(request)) {
            if (turn.signal.aborted) {
                return "";
            }
            if (event.type === "done") {
                completed = event.message;
            } else if (event.type === "error") {
                throw new Error(
                    event.message.errorMessage ?? "Context compaction failed"
                );
            }
        }
        if (!completed) {
            throw new Error("Context compaction ended without a completion event");
        }
        const summary = completed.content
            .filter((block) => block.type === "text")
            .map((block) => block.type === "text" ? block.text : "")
            .join("\n")
            .trim();
        if (summary.length === 0) {
            throw new Error("Context compaction produced an empty summary");
        }
        return summary;
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
        this.logger.info("Background shell task exited", {
            sessionId: this.meta.id,
            taskId: sessionId,
            exitCode,
            hasError: error !== null,
            unreadCharacters
        });
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
            this.logger.error("Failed to persist a pending system message", error, {
                sessionId: this.meta.id
            });
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

function elapsedMs(startedAt: number): number {
    return Math.round((performance.now() - startedAt) * 10) / 10;
}
