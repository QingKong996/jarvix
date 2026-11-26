import { createHash, randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import type {
    LlmAssistantMessage,
    LlmMessage,
    LlmSystemMessage,
    LlmSystemNotice,
    LlmToolCallBlock,
    LlmStreamEvent,
    LlmUsage,
    LlmUserMessage
} from "../../../protocol/llm.ts";
import type { LlmProviderResponse, LlmRequest } from "../../llm/index.ts";
import type { JarvixContextUsage } from "../../../protocol/context-usage.ts";
import type { JarvixProviderContext } from "../../../protocol/provider-context.ts";
import type {
    PermissionDecision,
    PermissionMode
} from "../../../protocol/permission.ts";
import type {
    JarvixGoal,
    JarvixSession,
    JarvixSessionMeta
} from "../../../protocol/session.ts";
import { type JarvixLogger, noopLogger } from "../../logger.ts";
import {
    noopAgentObserver,
    type AgentFirstTokenKind,
    type AgentObserver,
    type AgentRunOutcome,
    type AgentTurnOutcome
} from "../../observability/index.ts";
import {
    resolveConfiguredModel,
    resolveReasoningLevel
} from "../../../protocol/providers.ts";
import {
    createDefaultTools,
    type ToolExecutor,
    type GoalFinishResult,
    type ToolManager
} from "../../../runtime/tools/index.ts";
import { SessionPermissions } from "../../permissions/session-permissions.ts";
import {
    createDefaultContextManager,
    type ContextManager,
    type ContextManagerFactory
} from "./context-manager.ts";
import {
    agentInstructionPathsForToolCall,
    agentInstructionsMessage
} from "./agent-instructions.ts";
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
import {
    ToolCallRunner,
    type ToolCallTelemetryResult,
    type ToolTelemetryContext
} from "./tool-runner.ts";
import type { SessionRuntime } from "./types.ts";
import {
    GoalVerifier,
    verifierResultText
} from "../goal/goal-verifier.ts";
import {
    clearSessionGoal,
    updateSessionGoal
} from "../persistence/store.ts";

export const MAX_TOOL_ROUNDS = 32;
const SHUTDOWN_TIMEOUT_MS = 10_000;
const MAX_CONTEXT_COMPACTION_ATTEMPTS = 8;
export type { SessionRuntime } from "./types.ts";

type TurnDecision = "continue" | "complete" | "failed";

type TurnContext = {
    runtime: SessionRuntime;
    signal: AbortSignal;
    contextWindow: number;
    requestStartedAt: number;
    request: Omit<LlmRequest, "messages" | "signal" | "tools">;
    run: RunTelemetry;
    autoContinue: boolean;
    sandboxPaths: readonly string[];
    sandboxPathsExempted: boolean;
};

type RunTelemetry = {
    runId: string;
    provider: string | undefined;
    model: string | undefined;
    contextWindow: number | undefined;
    contextTokensStart: number | undefined;
    reasoningLevel: string | undefined;
    systemPromptHash: string | undefined;
    toolsetHash: string | undefined;
    toolCount: number | undefined;
    llmTurns: number;
    agentSteps: number;
    mainTurnIndex: number;
    compactionTurnIndex: number;
    toolCalls: number;
    toolErrors: number;
    repeatToolCalls: number;
    permissionRequests: number;
    permissionWaitMs: number;
    compactions: number;
    compactionDurationMs: number;
    compactionInputTokens: number | null;
    compactionOutputTokens: number | null;
    llmDurationMs: number;
    toolDurationMs: number;
    toolExecutionMs: number;
    ttftMs: number | null;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    reasoningTokens: number;
    costUsd: number;
    generationMs: number;
    usageSeen: boolean;
    reasoningSeen: boolean;
    finalStopReason: string | null;
    toolNames: string[];
    toolKeys: Map<string, number>;
    toolStepIndex: number;
    injectedPrompts: number;
    submitToFirstTokenMs: number | null;
    llmHttpAttempts: number;
    llmRetries: number;
    rateLimitResponses: number;
    retryAfterMs: number;
    providerHttpStatus: number | undefined;
    maxRoundsHit?: boolean;
    failure: RunFailure | null;
    heartbeat: ReturnType<typeof setInterval> | null;
};

type RunFailure = {
    stage: string;
    code: string;
    message: string;
};

type CompactionSummaryResult = {
    text: string;
    usage?: LlmAssistantMessage["usage"];
    responseId?: string;
    responseModel?: string;
    stopReason?: string;
    durationMs: number;
    ttftMs?: number;
    firstTokenKind?: AgentFirstTokenKind;
    generationMs?: number;
    receivedTextChars: number;
    receivedThinkingChars: number;
};

/** In-memory state for one conversation. */
export class Session {
    readonly meta: JarvixSessionMeta;
    private readonly history: LlmMessage[];
    private readonly persistence: SessionPersistenceQueue;
    private readonly pendingMessages = new PendingMessageQueue();
    private readonly contextManager: ContextManager;
    private readonly toolRunner: ToolCallRunner;
    private readonly tools: ToolExecutor;
    private readonly permissions: SessionPermissions;
    private readonly logger: JarvixLogger;
    private readonly observer: AgentObserver;
    private readonly idleWaiters = new Set<() => void>();
    private running = false;
    private streamOpen = false;
    private toolUseOpen = false;
    private requestController: AbortController | null = null;
    private lastRuntime: SessionRuntime | null = null;
    private contextWindow: number | null = null;
    private shutdownPromise: Promise<void> | null = null;
    private activeRun: RunTelemetry | null = null;
    private goalFinished = false;
    private readonly goalVerifier = new GoalVerifier();

    constructor(
        meta: JarvixSessionMeta,
        messages: readonly LlmMessage[] = [],
        tools: ToolExecutor = createDefaultTools(),
        permissions: SessionPermissions = new SessionPermissions(),
        contextManagerFactory: ContextManagerFactory = createDefaultContextManager,
        logger: JarvixLogger = noopLogger,
        observer: AgentObserver = noopAgentObserver
    ) {
        this.meta = meta;
        this.logger = logger;
        this.observer = observer;
        this.contextManager = contextManagerFactory(() => this.meta.permission);
        this.history = this.contextManager.initializeHistory(messages);
        this.permissions = permissions;
        this.tools = tools;
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
            logger,
            observer
        });
    }

    async request(
        question: string,
        runtime: SessionRuntime,
        sandboxPaths: readonly string[] = []
    ): Promise<void> {
        if (this.running) {
            this.logger.warn("Rejected request because the session is busy", {
                sessionId: this.meta.id
            });
            throw new Error(`Session is busy: ${this.meta.id}`);
        }
        const prompt = question.trim();
        if (prompt.length === 0 && !this.meta.goal) {
            throw new Error("A request requires a prompt or an active goal");
        }
        this.goalFinished = false;
        const startedAt = performance.now();
        const startedAtMs = Date.now();
        const historyMessagesAtStart = this.history.length;
        const selectedModel = runtime.config.selectedModel;
        const run: RunTelemetry = {
            runId: `run_${randomUUID()}`,
            provider: selectedModel?.provider,
            model: selectedModel?.id,
            contextWindow: undefined,
            contextTokensStart: undefined,
            reasoningLevel: undefined,
            systemPromptHash: undefined,
            toolsetHash: undefined,
            toolCount: undefined,
            llmTurns: 0,
            agentSteps: 0,
            mainTurnIndex: 0,
            compactionTurnIndex: 0,
            toolCalls: 0,
            toolErrors: 0,
            repeatToolCalls: 0,
            permissionRequests: 0,
            permissionWaitMs: 0,
            compactions: 0,
            compactionDurationMs: 0,
            compactionInputTokens: null,
            compactionOutputTokens: null,
            llmDurationMs: 0,
            toolDurationMs: 0,
            toolExecutionMs: 0,
            ttftMs: null,
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            reasoningTokens: 0,
            costUsd: 0,
            generationMs: 0,
            usageSeen: false,
            reasoningSeen: false,
            finalStopReason: null,
            toolNames: [],
            toolKeys: new Map(),
            toolStepIndex: 0,
            injectedPrompts: 0,
            submitToFirstTokenMs: null,
            llmHttpAttempts: 0,
            llmRetries: 0,
            rateLimitResponses: 0,
            retryAfterMs: 0,
            providerHttpStatus: undefined,
            failure: null,
            heartbeat: null
        };
        let runObserved = false;
        let outcome: AgentRunOutcome = "failed";
        let stage = "setup";
        const observeStart = (): void => {
            if (runObserved) {
                return;
            }
            runObserved = true;
            this.observer.runStarted({
                runId: run.runId,
                sessionId: this.meta.id,
                runType: "prompt",
                startedAtMs,
                lastHeartbeatMs: startedAtMs,
                provider: run.provider,
                model: run.model,
                permission: this.meta.permission,
                promptChars: question.length,
                promptHash: hashPrompt(question),
                historyMessagesAtStart,
                contextWindow: run.contextWindow,
                contextTokensStart: run.contextTokensStart,
                maxRounds: MAX_TOOL_ROUNDS,
                reasoningLevel: run.reasoningLevel,
                systemPromptHash: run.systemPromptHash,
                toolsetHash: run.toolsetHash,
                toolCount: run.toolCount
            });
            run.heartbeat = setInterval(() => {
                this.observer.heartbeat(run.runId, Date.now());
            }, 30_000);
            run.heartbeat.unref?.();
        };

        this.running = true;
        this.activeRun = run;
        this.lastRuntime = runtime;
        const controller = new AbortController();
        const { signal } = controller;
        this.requestController = controller;
        this.logger.info("Session request started", {
            sessionId: this.meta.id,
            runId: run.runId,
            promptLength: question.length,
            permission: this.meta.permission
        });

        try {
            stage = "setup";
            this.ensureEnvironmentContext(runtime);
            if (prompt.length > 0) {
                const questionMessage: LlmUserMessage = {
                    role: "user",
                    content: question,
                    timestamp: Date.now()
                };
                stage = "persistence";
                this.append(questionMessage);
            }
            const environmentReminder = this.appendEnvironmentReminderIfChanged(runtime);
            if (environmentReminder) {
                runtime.emit({ type: "system.message", message: environmentReminder });
            }

            stage = "model_resolve";
            const resolved = resolveConfiguredModel(runtime.config.providers, runtime.config.selectedModel);
            if (!resolved) {
                throw new Error("No model configured");
            }
            const { selection, model: definition } = resolved;
            run.provider = selection.provider;
            run.model = selection.id;
            run.contextWindow = definition.contextWindow;
            const reasoning = resolveReasoningLevel(
                definition,
                runtime.config.reasoning
            );
            const registeredTools = this.registeredTools();
            run.reasoningLevel = reasoning;
            run.systemPromptHash = hashText(this.contextManager.systemPrompt);
            run.toolsetHash = hashToolset(registeredTools);
            run.toolCount = registeredTools.length;
            const provider = runtime.config.providers?.find((item) => item.id === selection.provider);
            const model = runtime.llm.getModel(selection.provider, selection.id);
            if (!model) {
                throw new Error(`Model not found: ${selection.provider}/${selection.id}`);
            }

            this.contextWindow = definition.contextWindow;
            run.contextTokensStart = this.contextTokens(
                definition.contextWindow,
                runtime.workingDirectories ?? []
            );
            observeStart();
            this.logger.debug("Session request resolved model", {
                sessionId: this.meta.id,
                runId: run.runId,
                provider: selection.provider,
                model: selection.id,
                reasoning: runtime.config.reasoning,
                messageCount: this.history.length
            });
            const turn: TurnContext = {
                runtime,
                signal,
                contextWindow: definition.contextWindow,
                requestStartedAt: startedAt,
                request: {
                    model,
                    systemPrompt: this.contextManager.systemPrompt,
                    reasoning,
                    apiKey: provider?.apiKey,
                    maxTokens: definition.maxTokens
                },
                run,
                autoContinue: false,
                sandboxPaths,
                sandboxPathsExempted: false
            };
            stage = "compaction";
            await this.compactContextIfNeeded(turn);
            this.emitContextUsage(turn);

            for (let round = 0; ;) {
                if (signal.aborted) {
                    outcome = "aborted";
                    break;
                }
                if (round >= MAX_TOOL_ROUNDS) {
                    run.maxRoundsHit = true;
                    stage = "agent_loop";
                    throw new Error(`Tool call limit exceeded (${MAX_TOOL_ROUNDS})`);
                }

                stage = "compaction";
                await this.compactContextIfNeeded(turn);
                stage = "llm_stream";
                const decision = await this.takeTurn(turn, turn.autoContinue);
                if (signal.aborted) {
                    outcome = "aborted";
                    break;
                }
                if (decision === "failed") {
                    outcome = "failed";
                    break;
                }
                stage = "persistence";
                if (this.flushPendingTurnMessages(runtime)) {
                    turn.autoContinue = false;
                    round = 0;
                    continue;
                }
                if (decision === "complete") {
                    if (this.meta.goal && !this.goalFinished) {
                        turn.autoContinue = true;
                        round = 0;
                        continue;
                    }
                    outcome = "completed";
                    break;
                }
                turn.autoContinue = false;
                round += 1;
            }
        } catch (error) {
            if (signal.aborted) {
                outcome = "aborted";
                return;
            }
            outcome = run.maxRoundsHit ? "max_rounds" : "failed";
            run.failure ??= failureFor(stage, error);
            const reason = error instanceof Error ? error.message : String(error);
            this.logger.error("Session request failed", error, {
                sessionId: this.meta.id,
                runId: run.runId,
                stage,
                durationMs: elapsedMs(startedAt)
            });
            runtime.emit({ type: "request.error", error: reason });
            throw error;
        } finally {
            if (run.heartbeat) {
                clearInterval(run.heartbeat);
                run.heartbeat = null;
            }
            this.toolUseOpen = false;
            this.streamOpen = false;
            this.pendingMessages.discardPrompts();
            this.flushPendingSystemMessages(runtime);
            observeStart();
            const endedAtMs = Date.now();
            const durationMs = Math.round(performance.now() - startedAt);
            const contextTokensEnd = run.contextWindow === undefined
                ? undefined
                : this.contextTokens(run.contextWindow, runtime.workingDirectories ?? []);
            this.observer.runFinished(run.runId, {
                endedAtMs,
                durationMs,
                outcome,
                provider: run.provider,
                model: run.model,
                activeDurationMs: Math.max(0, durationMs - run.permissionWaitMs),
                errorStage: run.failure?.stage,
                errorCode: run.failure?.code,
                errorMessage: run.failure?.message,
                contextTokensEnd,
                contextUtilizationEnd: ratio(contextTokensEnd, run.contextWindow),
                llmTurns: run.llmTurns,
                toolCalls: run.toolCalls,
                agentSteps: run.agentSteps,
                maxRoundsHit: run.maxRoundsHit,
                injectedPrompts: run.injectedPrompts,
                toolErrors: run.toolErrors,
                repeatToolCalls: run.repeatToolCalls,
                permissionRequests: run.permissionRequests,
                permissionWaitMs: run.permissionWaitMs,
                compactions: run.compactions,
                compactionDurationMs: run.compactionDurationMs,
                compactionInputTokens: run.compactionInputTokens ?? undefined,
                compactionOutputTokens: run.compactionOutputTokens ?? undefined,
                llmDurationMs: run.llmDurationMs,
                toolDurationMs: run.toolDurationMs,
                toolExecutionMs: run.toolExecutionMs,
                unaccountedMs: Math.max(
                    0,
                    durationMs - run.llmDurationMs - run.toolDurationMs
                ),
                ttftMs: run.ttftMs ?? undefined,
                inputTokens: run.usageSeen ? run.inputTokens : undefined,
                outputTokens: run.usageSeen ? run.outputTokens : undefined,
                cacheReadTokens: run.usageSeen ? run.cacheReadTokens : undefined,
                cacheWriteTokens: run.usageSeen ? run.cacheWriteTokens : undefined,
                reasoningTokens: run.reasoningSeen ? run.reasoningTokens : undefined,
                costUsd: run.usageSeen ? run.costUsd : undefined,
                tokensPerSecond: run.usageSeen
                    ? rate(run.outputTokens, run.generationMs)
                    : undefined,
                wallTokensPerSecond: run.usageSeen
                    ? rate(run.outputTokens, durationMs)
                    : undefined,
                finalStopReason: run.finalStopReason ?? undefined,
                toolSequenceJson: JSON.stringify(run.toolNames),
                submitToFirstTokenMs: run.submitToFirstTokenMs ?? undefined,
                llmHttpAttempts: run.llmHttpAttempts,
                llmRetries: run.llmRetries,
                rateLimitResponses: run.rateLimitResponses,
                retryAfterMs: run.retryAfterMs,
                providerHttpStatus: run.providerHttpStatus
            });
            if (this.activeRun === run) {
                this.activeRun = null;
            }
            this.running = false;
            if (this.requestController === controller) {
                this.requestController = null;
            }
            this.notifyIdle();
            this.logger.info("Session request finished", {
                sessionId: this.meta.id,
                runId: run.runId,
                durationMs: elapsedMs(startedAt),
                outcome
            });
        }
    }

    abort(): void {
        this.pendingMessages.discardPrompts();
        const runId = this.activeRun?.runId;
        if (this.running) {
            this.logger.info("Aborting session request", {
                sessionId: this.meta.id
            });
        }
        this.requestController?.abort();
        if (this.running) {
            this.observer.event({
                tsMs: Date.now(),
                event: "request.abort_requested",
                sessionId: this.meta.id,
                runId
            });
        }
    }

    setGoal(content: string, emitUpdate = true): JarvixGoal {
        const goal = updateSessionGoal(this.meta.id, content);
        this.meta.goal = goal;
        this.goalFinished = false;
        if (emitUpdate) {
            this.emitGoal();
        }
        return goal;
    }

    clearGoal(emitUpdate = true): void {
        clearSessionGoal(this.meta.id);
        delete this.meta.goal;
        this.goalFinished = false;
        if (emitUpdate) {
            this.emitGoal();
        }
    }

    async finishGoal(signal: AbortSignal): Promise<GoalFinishResult> {
        const runtime = this.lastRuntime;
        if (!this.meta.goal) {
            return {
                passed: false,
                reason: "There is no active goal."
            };
        }
        if (!runtime) {
            return {
                passed: false,
                reason: "The session runtime is unavailable."
            };
        }
        const verification = await this.goalVerifier.verify({
            sessionId: this.meta.id,
            goal: this.meta.goal.content,
            permission: this.meta.permission,
            workingDirectories: runtime.workingDirectories ?? [],
            llm: runtime.llm,
            config: runtime.config,
            tools: this.tools,
            permissions: this.permissions,
            signal,
            emit: runtime.emit,
            logger: this.logger
        });
        if (verification.passed) {
            this.clearGoal();
            this.goalFinished = true;
        }
        return {
            passed: verification.passed,
            reason: verifierResultText(verification)
        };
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

    exemptSandboxPaths(paths: readonly string[]): void {
        const unique = [...new Set(paths)];
        if (unique.length === 0 || this.meta.permission === "full-access") {
            return;
        }
        const invalid = unique.find((path) => !isAbsolute(path));
        if (invalid) {
            throw new Error(`Sandbox path must be absolute: ${invalid}`);
        }
        const writable = this.meta.permission === "project-read-write"
            || this.meta.permission === "auto-review";
        this.permissions.grantDirectories(unique.flatMap((path) => [
            { action: "enable" as const, access: "read" as const, path },
            ...(writable
                ? [{ action: "enable" as const, access: "write" as const, path }]
                : [])
        ]));
        this.logger.info("Sandbox paths exempted", {
            sessionId: this.meta.id,
            pathCount: unique.length,
            writable
        });
    }

    registerToolManager(manager: ToolManager): void {
        this.toolRunner.registerToolManager(manager);
    }

    async unregisterToolManager(managerId: string): Promise<void> {
        await this.toolRunner.unregisterToolManager(managerId);
    }

    private async takeTurn(
        turn: TurnContext,
        autoContinue: boolean
    ): Promise<TurnDecision> {
        const { runtime, signal, run } = turn;
        if (signal.aborted) {
            return "failed";
        }

        const turnIndex = run.mainTurnIndex;
        run.mainTurnIndex += 1;
        run.llmTurns += 1;
        run.agentSteps += 1;
        const turnId = `${run.runId}:t${turnIndex}`;
        const streamStartedAt = performance.now();
        const streamStartedAtMs = Date.now();
        const requestContext = this.contextManager.prepareRequest(
            this.history,
            runtime.workingDirectories ?? [],
            {
                goal: this.meta.goal?.content,
                requireFinishGoal: autoContinue
            }
        );
        const messages = requestContext.messages;
        const contextTokensBefore = this.contextTokens(
            turn.contextWindow,
            runtime.workingDirectories ?? []
        );
        this.observer.turnStarted({
            turnId,
            sessionId: this.meta.id,
            runId: run.runId,
            turnKind: "main",
            turnIndex,
            startedAtMs: streamStartedAtMs,
            provider: turn.request.model.provider,
            model: turn.request.model.id,
            messageCount: messages.length,
            contextTokensBefore
        });
        let completed: LlmAssistantMessage | undefined;
        let streamErrorReported = false;
        let streamErrorMessage: string | undefined;
        let firstTokenAt: number | null = null;
        let firstTokenKind: AgentFirstTokenKind | undefined;
        let receivedTextChars = 0;
        let receivedThinkingChars = 0;
        let turnError: unknown;
        let turnOutcome: AgentTurnOutcome = "error";
        const providerHooks = createProviderHooks({
            observer: this.observer,
            sessionId: this.meta.id,
            runId: run.runId,
            turnId,
            signal
        });
        const provider = providerHooks.telemetry;
        this.streamOpen = true;
        try {
            for await (const event of runtime.llm.stream({
                ...turn.request,
                systemPrompt: requestContext.systemPrompt,
                tools: this.registeredTools(),
                messages,
                signal,
                onProviderRequest: providerHooks.onProviderRequest,
                onProviderResponse: providerHooks.onProviderResponse,
                onProviderError: providerHooks.onProviderError
            })) {
                if (signal.aborted) {
                    break;
                }
                const tokenKind = firstTokenKindFor(event);
                if (tokenKind && firstTokenAt === null) {
                    firstTokenAt = performance.now();
                    firstTokenKind = tokenKind;
                }
                if (event.type === "text.delta") {
                    receivedTextChars += event.delta.length;
                } else if (event.type === "thinking.delta") {
                    receivedThinkingChars += event.delta.length;
                }
                runtime.emit(event);
                if (event.type === "done") {
                    completed = event.message;
                    try {
                        this.append(event.message);
                    } catch (error) {
                        run.failure ??= failureFor("persistence", error);
                        throw error;
                    }
                    this.emitContextUsage(turn);
                    this.toolUseOpen = event.message.stopReason === "toolUse";
                } else if (event.type === "error") {
                    completed = undefined;
                    streamErrorReported = true;
                    streamErrorMessage = event.message.errorMessage
                        ?? "Model stream returned an error";
                    this.logger.warn("Model stream returned an error", {
                        sessionId: this.meta.id,
                        runId: run.runId,
                        turnId,
                        provider: event.message.provider,
                        model: event.message.model,
                        error: event.message.errorMessage
                    });
                }
            }
            if (!signal.aborted && !completed && !streamErrorReported) {
                throw new Error("Model response ended without a completion event");
            }
        } catch (error) {
            turnError = error;
            run.failure ??= failureFor(
                signal.aborted ? "aborted" : "llm_stream",
                error,
                provider.providerHttpStatus
            );
            throw error;
        } finally {
            this.streamOpen = false;
            const streamEndedAt = performance.now();
            const durationMs = Math.round(streamEndedAt - streamStartedAt);
            const ttftMs = firstTokenAt === null
                ? undefined
                : Math.round(firstTokenAt - streamStartedAt);
            const generationMs = firstTokenAt === null
                ? undefined
                : Math.round(streamEndedAt - firstTokenAt);
            const usage = completed?.usage;
            const toolCalls = completed?.stopReason === "toolUse"
                ? completed.content.filter(
                    (block): block is LlmToolCallBlock => block.type === "toolCall"
                )
                : [];
            turnOutcome = signal.aborted
                ? "aborted"
                : turnError || !completed
                    ? "error"
                    : "completed";
            if (turnOutcome === "error" && !run.failure) {
                run.failure = {
                    stage: "llm_stream",
                    code: streamErrorReported
                        ? llmFailureCode(
                            streamErrorMessage,
                            provider.providerHttpStatus
                        )
                        : "llm_no_completion",
                    message: streamErrorMessage
                        ?? "Model response ended without a completion event"
                };
            }
            this.observer.turnFinished(turnId, {
                endedAtMs: Date.now(),
                durationMs,
                outcome: turnOutcome,
                ttftMs,
                firstTokenKind,
                generationMs,
                inputTokens: usage?.inputTokens,
                outputTokens: usage?.outputTokens,
                cacheReadTokens: usage?.cacheReadTokens,
                cacheWriteTokens: usage?.cacheWriteTokens,
                reasoningTokens: usage?.reasoningTokens,
                costUsd: usage?.cost,
                tokensPerSecond: usage
                    ? rate(usage.outputTokens, generationMs)
                    : undefined,
                wallTokensPerSecond: usage
                    ? rate(usage.outputTokens, durationMs)
                    : undefined,
                stopReason: completed?.stopReason,
                responseId: completed?.responseId,
                responseModel: completed?.responseModel,
                toolCalls: toolCalls.length,
                contextTokensAfter: this.contextTokens(
                    turn.contextWindow,
                    runtime.workingDirectories ?? []
                ),
                receivedTextChars,
                receivedThinkingChars,
                llmHttpAttempts: provider.attempts,
                llmRetries: Math.max(0, provider.attempts - 1),
                rateLimitResponses: provider.rateLimitResponses,
                retryAfterMs: provider.retryAfterMs,
                providerHttpStatus: provider.providerHttpStatus,
                errorCode: turnOutcome === "error"
                    ? run.failure?.code ?? "llm_turn_failed"
                    : undefined,
                errorMessage: turnOutcome === "error"
                    ? run.failure?.message ?? errorMessage(turnError)
                    : undefined
            });
            run.llmDurationMs += durationMs;
            if (turnIndex === 0 && run.ttftMs === null && ttftMs !== undefined) {
                run.ttftMs = ttftMs;
            }
            if (
                turnIndex === 0
                && run.submitToFirstTokenMs === null
                && firstTokenAt !== null
            ) {
                run.submitToFirstTokenMs = Math.max(
                    0,
                    Math.round(firstTokenAt - turn.requestStartedAt)
                );
            }
            run.llmHttpAttempts += provider.attempts;
            run.llmRetries += Math.max(0, provider.attempts - 1);
            run.rateLimitResponses += provider.rateLimitResponses;
            run.retryAfterMs += provider.retryAfterMs;
            run.providerHttpStatus = provider.providerHttpStatus
                ?? run.providerHttpStatus;
            if (usage) {
                recordUsage(run, usage);
                run.generationMs += usage.outputTokens > 0
                    ? generationMs ?? durationMs
                    : 0;
                if (turnOutcome === "completed") {
                    run.finalStopReason = completed?.stopReason ?? run.finalStopReason;
                }
            }
        }

        if (signal.aborted) {
            return "failed";
        }
        if (!completed) {
            run.failure ??= {
                stage: "llm_stream",
                code: streamErrorReported
                    ? llmFailureCode(
                        streamErrorMessage,
                        provider.providerHttpStatus
                    )
                    : "llm_no_completion",
                message: streamErrorMessage
                    ?? "Model response ended without a completion event"
            };
            return "failed";
        }

        const toolCalls = completed.stopReason === "toolUse"
            ? completed.content.filter(
                (block): block is LlmToolCallBlock => block.type === "toolCall"
            )
            : [];
        this.logger.debug("Model response received", {
            sessionId: this.meta.id,
            runId: run.runId,
            turnId,
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
            if (!turn.sandboxPathsExempted) {
                this.exemptSandboxPaths(turn.sandboxPaths);
                turn.sandboxPathsExempted = true;
            }
            const toolTelemetry = this.telemetryForToolCalls(
                run,
                turnId,
                turnIndex,
                toolCalls
            );
            try {
                for (const [index, toolCall] of toolCalls.entries()) {
                    if (signal.aborted) {
                        for (let remaining = index; remaining < toolCalls.length; remaining += 1) {
                            this.toolRunner.cancel(
                                toolCalls[remaining]!,
                                runtime,
                                toolTelemetry[remaining]
                            );
                        }
                        break;
                    }
                    await this.executeToolCall(
                        toolCall,
                        runtime,
                        signal,
                        toolTelemetry[index]
                    );
                    this.emitContextUsage(turn);
                }
            } finally {
                this.toolUseOpen = false;
            }
            if (!signal.aborted) {
                this.appendAgentInstructionsForToolCalls(toolCalls, runtime);
            }
        } else {
            this.toolUseOpen = false;
        }

        if (signal.aborted) {
            return "failed";
        }

        if (this.goalFinished) {
            return "complete";
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
        return this.contextManager.prepareRequest(
            this.history,
            workingDirectories,
            { goal: this.meta.goal?.content }
        );
    }

    contextUsage(
        contextWindow: number,
        workingDirectories: readonly string[] = []
    ): JarvixContextUsage {
        return this.contextManager.estimateUsage({
            contextWindow,
            history: this.history,
            workingDirectories,
            tools: this.registeredTools(),
            goal: this.meta.goal?.content
        });
    }

    private contextTokens(
        contextWindow: number,
        workingDirectories: readonly string[]
    ): number | undefined {
        try {
            return this.contextUsage(
                contextWindow,
                workingDirectories
            ).estimatedTokens;
        } catch (error) {
            this.logger.debug("Context usage estimate failed", {
                sessionId: this.meta.id,
                reason: errorMessage(error)
            });
            return undefined;
        }
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
        signal: AbortSignal,
        telemetry?: ToolTelemetryContext
    ): Promise<void> {
        await this.toolRunner.execute(toolCall, runtime, signal, telemetry);
    }

    private telemetryForToolCalls(
        run: RunTelemetry,
        turnId: string,
        turnIndex: number,
        toolCalls: readonly LlmToolCallBlock[]
    ): ToolTelemetryContext[] {
        const keys = toolCalls.map(toolDedupeKey);
        const batchCounts = new Map<string, number>();
        for (const key of keys) {
            batchCounts.set(key, (batchCounts.get(key) ?? 0) + 1);
        }
        const totals = new Map<string, number>();
        for (const [key, count] of batchCounts) {
            const total = (run.toolKeys.get(key) ?? 0) + count;
            totals.set(key, total);
            run.toolKeys.set(key, total);
        }

        const seen = new Map<string, number>();
        return toolCalls.map((toolCall, index) => {
            const key = keys[index]!;
            const seenIndex = seen.get(key) ?? 0;
            seen.set(key, seenIndex + 1);
            const repeatIndex = (totals.get(key)! - batchCounts.get(key)!) + seenIndex;
            const repeatGroupSize = totals.get(key)!;
            const stepIndex = run.toolStepIndex;
            run.toolStepIndex += 1;
            run.toolCalls += 1;
            run.toolNames.push(toolCall.name);
            if (repeatIndex > 0) {
                run.repeatToolCalls += 1;
            }
            return {
                runId: run.runId,
                turnId,
                turnIndex,
                stepIndex,
                repeatIndex,
                repeatGroupSize,
                onFinished: (result) => {
                    run.toolDurationMs += result.durationMs;
                    run.toolExecutionMs += result.executionMs;
                    run.permissionRequests += result.permissionRequests;
                    run.permissionWaitMs += result.permissionWaitMs;
                    if (result.outcome === "error") {
                        run.toolErrors += 1;
                    }
                }
            };
        });
    }

    private registeredTools() {
        return this.toolRunner.registeredTools(this.meta.permission);
    }

    private appendAgentInstructionsForToolCalls(
        toolCalls: readonly LlmToolCallBlock[],
        runtime: SessionRuntime
    ): void {
        const workingDirectories = runtime.workingDirectories ?? [];
        if (workingDirectories.length === 0) {
            return;
        }
        const paths = toolCalls.flatMap(
            (toolCall) => agentInstructionPathsForToolCall(toolCall, workingDirectories)
        );
        if (paths.length === 0) {
            return;
        }
        const sources = this.contextManager.discoverAgentInstructions?.(
            paths,
            workingDirectories
        ) ?? [];
        if (sources.length === 0) {
            return;
        }

        const message = agentInstructionsMessage(sources);
        this.append(message);
        this.emitContextUsageFor(runtime, this.contextWindow);
        this.logger.info("Loaded AGENTS.md instructions", {
            sessionId: this.meta.id,
            paths: sources.map((source) => source.path)
        });
    }

    private ensureEnvironmentContext(runtime: SessionRuntime): void {
        const message = this.contextManager.ensureEnvironmentContext(
            runtime.workingDirectories
        );
        if (message) {
            this.history.unshift(message);
        }
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
                runId: turn.run.runId,
                selectedMessageCount: selected.length,
                estimatedTokens: usage.estimatedTokens,
                triggerTokens
            });
            const summary = await this.generateCompactionSummary(selected, turn);
            if (!summary || turn.signal.aborted) {
                return;
            }
            const message: LlmUserMessage = {
                role: "user",
                content: compactBlockContent(summary.text),
                context: "compact",
                timestamp: Date.now()
            };
            this.history.splice(
                selection.start,
                selection.end - selection.start,
                message
            );
            try {
                this.persistence.enqueueCompaction(message, selected);
            } catch (error) {
                turn.run.failure ??= failureFor("persistence", error);
                throw error;
            }
            turn.run.compactions += 1;
            turn.run.compactionDurationMs += summary.durationMs;
            if (summary.usage) {
                turn.run.compactionInputTokens =
                    (turn.run.compactionInputTokens ?? 0) + summary.usage.inputTokens;
                turn.run.compactionOutputTokens =
                    (turn.run.compactionOutputTokens ?? 0) + summary.usage.outputTokens;
            }
            this.emitContextUsageFor(turn.runtime, turn.contextWindow);
            this.logger.info("Context compaction completed", {
                sessionId: this.meta.id,
                runId: turn.run.runId,
                compactedMessageCount: selected.length,
                durationMs: elapsedMs(startedAt)
            });
        }
    }

    private async generateCompactionSummary(
        messages: readonly LlmMessage[],
        turn: TurnContext
    ): Promise<CompactionSummaryResult | null> {
        const run = turn.run;
        const turnIndex = run.compactionTurnIndex;
        run.compactionTurnIndex += 1;
        run.llmTurns += 1;
        const turnId = `${run.runId}:c${turnIndex}`;
        const startedAt = performance.now();
        const startedAtMs = Date.now();
        const contextTokensBefore = this.contextTokens(
            turn.contextWindow,
            turn.runtime.workingDirectories ?? []
        );
        this.observer.turnStarted({
            turnId,
            sessionId: this.meta.id,
            runId: run.runId,
            turnKind: "compaction",
            turnIndex,
            startedAtMs,
            provider: turn.request.model.provider,
            model: turn.request.model.id,
            messageCount: 1,
            contextTokensBefore
        });
        let completed: LlmAssistantMessage | undefined;
        let streamErrorMessage: string | undefined;
        let firstTokenAt: number | null = null;
        let firstTokenKind: AgentFirstTokenKind | undefined;
        let receivedTextChars = 0;
        let receivedThinkingChars = 0;
        let turnError: unknown;
        let turnOutcome: AgentTurnOutcome = "error";
        const providerHooks = createProviderHooks({
            observer: this.observer,
            sessionId: this.meta.id,
            runId: run.runId,
            turnId,
            signal: turn.signal
        });
        const provider = providerHooks.telemetry;
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
            signal: turn.signal,
            onProviderRequest: providerHooks.onProviderRequest,
            onProviderResponse: providerHooks.onProviderResponse,
            onProviderError: providerHooks.onProviderError
        };

        this.streamOpen = true;
        try {
            for await (const event of turn.runtime.llm.stream(request)) {
                if (turn.signal.aborted) {
                    turnOutcome = "aborted";
                    return null;
                }
                const tokenKind = firstTokenKindFor(event);
                if (tokenKind && firstTokenAt === null) {
                    firstTokenAt = performance.now();
                    firstTokenKind = tokenKind;
                }
                if (event.type === "text.delta") {
                    receivedTextChars += event.delta.length;
                } else if (event.type === "thinking.delta") {
                    receivedThinkingChars += event.delta.length;
                }
                if (event.type === "done") {
                    completed = event.message;
                } else if (event.type === "error") {
                    streamErrorMessage = event.message.errorMessage
                        ?? "Context compaction failed";
                    throw new Error(streamErrorMessage);
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
            const streamEndedAt = performance.now();
            turnOutcome = "completed";
            return {
                text: summary,
                usage: completed.usage,
                responseId: completed.responseId,
                responseModel: completed.responseModel,
                stopReason: completed.stopReason,
                durationMs: Math.round(streamEndedAt - startedAt),
                ttftMs: firstTokenAt === null
                    ? undefined
                    : Math.round(firstTokenAt - startedAt),
                firstTokenKind,
                generationMs: firstTokenAt === null
                    ? undefined
                    : Math.round(streamEndedAt - firstTokenAt),
                receivedTextChars,
                receivedThinkingChars
            };
        } catch (error) {
            turnError = error;
            run.failure ??= failureFor(
                "compaction",
                error,
                provider.providerHttpStatus
            );
            throw error;
        } finally {
            this.streamOpen = false;
            const streamEndedAt = performance.now();
            const durationMs = Math.round(streamEndedAt - startedAt);
            const ttftMs = firstTokenAt === null
                ? undefined
                : Math.round(firstTokenAt - startedAt);
            const generationMs = firstTokenAt === null
                ? undefined
                : Math.round(streamEndedAt - firstTokenAt);
            if (turn.signal.aborted) {
                turnOutcome = "aborted";
            }
            const usage = completed?.usage;
            this.observer.turnFinished(turnId, {
                endedAtMs: Date.now(),
                durationMs,
                outcome: turnOutcome,
                ttftMs,
                firstTokenKind,
                generationMs,
                inputTokens: usage?.inputTokens,
                outputTokens: usage?.outputTokens,
                cacheReadTokens: usage?.cacheReadTokens,
                cacheWriteTokens: usage?.cacheWriteTokens,
                reasoningTokens: usage?.reasoningTokens,
                costUsd: usage?.cost,
                tokensPerSecond: usage
                    ? rate(usage.outputTokens, generationMs)
                    : undefined,
                wallTokensPerSecond: usage
                    ? rate(usage.outputTokens, durationMs)
                    : undefined,
                stopReason: completed?.stopReason,
                responseId: completed?.responseId,
                responseModel: completed?.responseModel,
                toolCalls: 0,
                receivedTextChars,
                receivedThinkingChars,
                llmHttpAttempts: provider.attempts,
                llmRetries: Math.max(0, provider.attempts - 1),
                rateLimitResponses: provider.rateLimitResponses,
                retryAfterMs: provider.retryAfterMs,
                providerHttpStatus: provider.providerHttpStatus,
                errorCode: turnOutcome === "error"
                    ? "compaction_failed"
                    : undefined,
                errorMessage: turnOutcome === "error"
                    ? streamErrorMessage ?? errorMessage(turnError)
                    : undefined
            });
            run.llmDurationMs += durationMs;
            run.llmHttpAttempts += provider.attempts;
            run.llmRetries += Math.max(0, provider.attempts - 1);
            run.rateLimitResponses += provider.rateLimitResponses;
            run.retryAfterMs += provider.retryAfterMs;
            run.providerHttpStatus = provider.providerHttpStatus
                ?? run.providerHttpStatus;
            if (usage) {
                recordUsage(run, usage);
                run.generationMs += usage.outputTokens > 0
                    ? generationMs ?? durationMs
                    : 0;
            }
        }
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

    private emitGoal(): void {
        const runtime = this.lastRuntime;
        if (!runtime) {
            return;
        }
        runtime.emit({
            type: "goal.updated",
            goal: this.meta.goal ?? null
        });
        this.emitContextUsageFor(runtime, this.contextWindow);
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
        this.goalFinished = false;
        if (this.activeRun) {
            this.activeRun.injectedPrompts += 1;
        }
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

function hashPrompt(prompt: string): string {
    return createHash("sha256").update(prompt).digest("hex").slice(0, 16);
}

function firstTokenKindFor(
    event: LlmStreamEvent
): AgentFirstTokenKind | undefined {
    switch (event.type) {
        case "text.delta":
            return "text";
        case "thinking.delta":
            return "thinking";
        case "toolCall.start":
            return "toolCall";
        default:
            return undefined;
    }
}

function recordUsage(run: RunTelemetry, usage: LlmUsage): void {
    run.usageSeen = true;
    run.inputTokens += usage.inputTokens;
    run.outputTokens += usage.outputTokens;
    run.cacheReadTokens += usage.cacheReadTokens;
    run.cacheWriteTokens += usage.cacheWriteTokens;
    run.costUsd += usage.cost;
    if (usage.reasoningTokens !== undefined) {
        run.reasoningSeen = true;
        run.reasoningTokens += usage.reasoningTokens;
    }
}

function rate(tokens: number, durationMs: number | undefined): number | undefined {
    if (durationMs === undefined || durationMs <= 0) {
        return undefined;
    }
    return Math.round((tokens / (durationMs / 1_000)) * 100) / 100;
}

function ratio(value: number | undefined, total: number | undefined): number | undefined {
    if (value === undefined || total === undefined || total <= 0) {
        return undefined;
    }
    return Math.round((value / total) * 10_000) / 10_000;
}

function toolDedupeKey(toolCall: LlmToolCallBlock): string {
    const serialized = stableJson(toolCall.arguments);
    return createHash("sha256")
        .update(toolCall.name)
        .update("\0")
        .update(serialized)
        .digest("hex");
}

function stableJson(value: unknown): string {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value) ?? "undefined";
    }
    if (Array.isArray(value)) {
        return `[${value.map(stableJson).join(",")}]`;
    }
    const entries = Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`);
    return `{${entries.join(",")}}`;
}

type ProviderTelemetry = {
    attempts: number;
    rateLimitResponses: number;
    retryAfterMs: number;
    providerHttpStatus: number | undefined;
    activeAttempt: {
        attemptId: string;
        startedAt: number;
        startedAtMs: number;
    } | null;
};

function createProviderTelemetry(): ProviderTelemetry {
    return {
        attempts: 0,
        rateLimitResponses: 0,
        retryAfterMs: 0,
        providerHttpStatus: undefined,
        activeAttempt: null
    };
}

function createProviderHooks(options: {
    observer: AgentObserver;
    sessionId: string;
    runId: string;
    turnId: string;
    signal: AbortSignal;
}): {
    telemetry: ProviderTelemetry;
    onProviderRequest: () => void;
    onProviderResponse: (response: LlmProviderResponse) => void;
    onProviderError: (error: unknown) => void;
} {
    const telemetry = createProviderTelemetry();
    return {
        telemetry,
        onProviderRequest: () => {
            const attemptIndex = telemetry.attempts;
            telemetry.attempts += 1;
            const attemptId = `${options.turnId}:a${attemptIndex}`;
            telemetry.activeAttempt = {
                attemptId,
                startedAt: performance.now(),
                startedAtMs: Date.now()
            };
            options.observer.llmAttemptStarted({
                attemptId,
                sessionId: options.sessionId,
                runId: options.runId,
                turnId: options.turnId,
                attemptIndex,
                startedAtMs: telemetry.activeAttempt.startedAtMs
            });
        },
        onProviderResponse: (response) => {
            recordProviderResponse(telemetry, response);
            finishProviderAttempt(
                options.observer,
                telemetry,
                response.status >= 400 ? "error" : "response",
                {
                    httpStatus: response.status,
                    retryAfterMs: response.retryAfterMs,
                    errorCode: response.status >= 400
                        ? `llm_http_${response.status}`
                        : undefined
                }
            );
        },
        onProviderError: (error) => {
            const cancelled = options.signal.aborted;
            finishProviderAttempt(
                options.observer,
                telemetry,
                cancelled ? "cancelled" : "error",
                {
                    errorCode: cancelled
                        ? "llm_cancelled"
                        : llmFailureCode(errorMessage(error))
                }
            );
        }
    };
}

function recordProviderResponse(
    telemetry: ProviderTelemetry,
    response: LlmProviderResponse
): void {
    telemetry.providerHttpStatus = response.status;
    if (response.status === 429) {
        telemetry.rateLimitResponses += 1;
    }
    if (response.retryAfterMs !== undefined) {
        telemetry.retryAfterMs += response.retryAfterMs;
    }
}

function finishProviderAttempt(
    observer: AgentObserver,
    telemetry: ProviderTelemetry,
    outcome: "response" | "error" | "cancelled",
    detail: {
        httpStatus?: number;
        retryAfterMs?: number;
        errorCode?: string;
    }
): void {
    const attempt = telemetry.activeAttempt;
    if (!attempt) {
        return;
    }
    telemetry.activeAttempt = null;
    const endedAtMs = Date.now();
    observer.llmAttemptFinished(attempt.attemptId, {
        endedAtMs,
        durationMs: Math.max(0, Math.round(performance.now() - attempt.startedAt)),
        outcome,
        httpStatus: detail.httpStatus,
        retryAfterMs: detail.retryAfterMs,
        errorCode: detail.errorCode
    });
}

function hashText(value: string): string {
    return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function hashToolset(
    tools: readonly {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    }[]
): string {
    return hashText(stableJson(tools));
}

function llmFailureCode(
    message: string | undefined,
    httpStatus?: number
): string {
    if (httpStatus === 429) {
        return "llm_rate_limited";
    }
    if (httpStatus === 401 || httpStatus === 403) {
        return "llm_auth";
    }
    if (httpStatus === 408 || httpStatus === 504) {
        return "llm_timeout";
    }
    if (httpStatus !== undefined && httpStatus >= 500) {
        return "llm_provider_error";
    }
    if (!message) {
        return "llm_stream_error";
    }
    if (/rate.?limit|too many requests|quota|usage limit|\b429\b/i.test(message)) {
        return "llm_rate_limited";
    }
    if (/unauthorized|forbidden|invalid api key|authentication|\b401\b|\b403\b/i.test(message)) {
        return "llm_auth";
    }
    if (/context (?:window|length)|too many tokens|maximum.*tokens|prompt is too long/i.test(message)) {
        return "llm_context_overflow";
    }
    if (/timed? ?out|timeout|ETIMEDOUT/i.test(message)) {
        return "llm_timeout";
    }
    if (/ECONN|ENOTFOUND|network|fetch failed|socket hang up/i.test(message)) {
        return "llm_network";
    }
    return "llm_stream_error";
}

function failureFor(
    stage: string,
    error: unknown,
    httpStatus?: number
): RunFailure {
    const message = errorMessage(error) ?? "Unknown error";
    if (/Failed to persist session|after 2 attempts/.test(message)) {
        return {
            stage: "persistence",
            code: "persistence_failed",
            message
        };
    }
    let code = `${stage}_failed`;
    if (stage === "agent_loop") {
        code = "max_rounds";
    } else if (stage === "model_resolve") {
        code = /not found/i.test(message)
            ? "model_not_found"
            : "model_not_configured";
    } else if (stage === "llm_stream") {
        code = llmFailureCode(message, httpStatus);
    } else if (stage === "compaction") {
        code = "compaction_failed";
    } else if (stage === "persistence") {
        code = "persistence_failed";
    } else if (stage === "aborted") {
        code = "aborted";
    }
    return { stage, code, message };
}

function errorMessage(error: unknown): string | undefined {
    if (error === undefined || error === null) {
        return undefined;
    }
    return error instanceof Error ? error.message : String(error);
}
