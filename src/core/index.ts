import { createHash, randomUUID } from "node:crypto";
import type { LlmAdapter } from "./llm/index.ts";
import { i18n } from "../i18n/index.ts";
import { type JarvixLogger, noopLogger } from "./logger.ts";
import type { JarvixConfig } from "../protocol/config.ts";
import type { JarvixContextUsage } from "../protocol/context-usage.ts";
import type { JarvixEvent, JarvixListener } from "../protocol/event.ts";
import type { JarvixProject } from "../protocol/project.ts";
import type { JarvixProviderContext } from "../protocol/provider-context.ts";
import type {
    JarvixGoal,
    JarvixSession,
    JarvixSessionContext,
    JarvixSessionSummary
} from "../protocol/session.ts";
import {
    sessionContextSchema,
    sessionGoalContentSchema,
    sessionNameSchema
} from "../protocol/session.ts";
import { resolveConfiguredModel } from "../protocol/providers.ts";
import {
    DEFAULT_PERMISSION_MODE,
    type PermissionMode
} from "../protocol/permission.ts";
import {
    noopAgentObserver,
    type AgentObserver
} from "./observability/index.ts";
import type { SandboxPreflight } from "./permissions/sandbox-launch.ts";
import type { ToolManager } from "../runtime/tools/tool-manager.ts";
import {
    createProject as createStoredProject,
    listProjects as listStoredProjects,
    loadProject
} from "./project/store.ts";
import { workingDirectoriesFor } from "./session/directories.ts";
import { SessionManager } from "./session/manager.ts";
import type { ContextManagerFactory } from "./session/runtime/context-manager.ts";
import type { Session } from "./session/runtime/session.ts";
import { generateSessionNameResult } from "./session/naming.ts";

export type JarvixOptions = {
    llm: LlmAdapter;
    config?: JarvixConfig;
    sandboxPreflight?: SandboxPreflight;
    contextManagerFactory?: ContextManagerFactory;
    toolManagers?: readonly ToolManager[];
    logger?: JarvixLogger;
    observer?: AgentObserver;
};

export class Jarvix {
    private readonly listeners = new Set<JarvixListener>();
    private config: JarvixConfig;
    private readonly llm: LlmAdapter;
    private readonly sessions: SessionManager;
    private readonly logger: JarvixLogger;
    private readonly observer: AgentObserver;

    constructor(options: JarvixOptions) {
        this.config = options.config ?? {};
        this.llm = options.llm;
        this.logger = options.logger ?? noopLogger;
        this.observer = options.observer ?? noopAgentObserver;
        this.sessions = new SessionManager(
            options.sandboxPreflight,
            options.contextManagerFactory,
            options.toolManagers,
            this.logger,
            this.observer
        );
        this.logger.info("Jarvix runtime initialized", {
            providerCount: this.config.providers?.length ?? 0,
            selectedModel: selectedModelLabel(this.config)
        });
    }

    setConfig(config: JarvixConfig): void {
        this.config = config;
        this.logger.info("Jarvix configuration applied", {
            providerCount: config.providers?.length ?? 0,
            selectedModel: selectedModelLabel(config),
            language: config.language
        });
        for (const session of this.sessions.listLoaded()) {
            this.emitContextUsage(session);
        }
    }

    createProject(name: string, workingDirectories: readonly string[]): JarvixProject {
        const project = createStoredProject(name, workingDirectories);
        this.logger.info("Project created", {
            projectId: project.id,
            workingDirectoryCount: project.workingDirectories.length
        });
        return project;
    }

    listProjects(): JarvixProject[] {
        return listStoredProjects();
    }

    createSession(
        context: JarvixSessionContext = {},
        name?: string,
        permission: PermissionMode = DEFAULT_PERMISSION_MODE
    ): JarvixSession {
        const normalizedContext = sessionContextSchema.parse(context);
        if (normalizedContext.projectId && !loadProject(normalizedContext.projectId)) {
            throw new Error(`Project not found: ${normalizedContext.projectId}`);
        }
        const sessionName = name?.trim() || i18n.t("sessions.untitled", { lng: this.config.language ?? "zh" });
        return this.snapshotSession(
            this.sessions.create(normalizedContext, sessionName, permission)
        );
    }

    loadSession(sessionId: string): JarvixSession | null {
        const session = this.sessions.load(sessionId);
        return session ? this.snapshotSession(session) : null;
    }

    releaseSession(sessionId: string): boolean {
        return this.sessions.releaseIfIdle(sessionId);
    }

    listSessions(): JarvixSessionSummary[] {
        return this.sessions.listSummaries().filter((session) => session.status === "active");
    }

    listArchivedSessions(): JarvixSessionSummary[] {
        return this.sessions.listArchivedSummaries();
    }

    archiveSession(sessionId: string): void {
        this.sessions.updateStatus(sessionId, "archived");
    }

    unarchiveSession(sessionId: string): void {
        this.sessions.updateStatus(sessionId, "active");
    }

    deleteSession(sessionId: string): void {
        this.sessions.delete(sessionId);
    }

    updateSessionContext(
        sessionId: string,
        context: JarvixSessionContext
    ): JarvixSessionContext {
        const normalizedContext = sessionContextSchema.parse(context);
        if (normalizedContext.projectId && !loadProject(normalizedContext.projectId)) {
            throw new Error(`Project not found: ${normalizedContext.projectId}`);
        }
        const updated = this.sessions.updateContext(sessionId, normalizedContext);
        const session = this.sessions.getLoaded(sessionId);
        if (session) {
            this.emitContextUsage(session);
        }
        return updated;
    }

    getPermission(sessionId: string): PermissionMode {
        return this.sessions.require(sessionId).meta.permission;
    }

    getProviderContext(sessionId: string): JarvixProviderContext {
        const session = this.sessions.require(sessionId);
        return session.providerContext(workingDirectoriesFor(session.meta));
    }

    setGoal(sessionId: string, content: string): JarvixGoal {
        const session = this.sessions.require(sessionId);
        const goal = session.setGoal(
            sessionGoalContentSchema.parse(content),
            false
        );
        this.emit(sessionId, { type: "goal.updated", goal });
        this.emitContextUsage(session);
        return goal;
    }

    clearGoal(sessionId: string): void {
        const session = this.sessions.require(sessionId);
        session.abort();
        session.clearGoal(false);
        this.emit(sessionId, { type: "goal.updated", goal: null });
        this.emitContextUsage(session);
    }

    setPermission(sessionId: string, permission: PermissionMode): PermissionMode {
        const updated = this.sessions.updatePermission(sessionId, permission);
        const session = this.sessions.getLoaded(sessionId);
        if (session) {
            this.emitContextUsage(session);
        }
        return updated;
    }

    respondPermission(sessionId: string, requestId: string, approved: boolean): boolean {
        return this.sessions.respondPermission(sessionId, requestId, approved);
    }

    async registerToolManager(manager: ToolManager): Promise<void> {
        await this.sessions.registerToolManager(manager);
        this.emitLoadedContextUsage();
    }

    async unregisterToolManager(managerId: string): Promise<boolean> {
        try {
            return await this.sessions.unregisterToolManager(managerId);
        } finally {
            this.emitLoadedContextUsage();
        }
    }

    renameSession(sessionId: string, name: string): string {
        const renamed = this.sessions.rename(sessionId, sessionNameSchema.parse(name));
        this.emit(sessionId, { type: "session.renamed", name: renamed });
        return renamed;
    }

    async autoNameSession(sessionId: string, firstPrompt?: string): Promise<string> {
        const startedAt = performance.now();
        const startedAtMs = Date.now();
        const { currentName, prompt } = this.sessions.namingContext(
            sessionId,
            firstPrompt
        );
        if (!prompt) {
            this.logger.warn("Session auto-naming requires a prompt", {
                sessionId
            });
            throw new Error("The session has no user prompt to name");
        }

        const runId = `run_${randomUUID()}`;
        const turnId = `${runId}:n0`;
        const selectedModel = this.config.selectedModel;
        let turnFinished = false;
        let runFinished = false;
        this.observer.runStarted({
            runId,
            sessionId,
            runType: "naming",
            startedAtMs,
            lastHeartbeatMs: startedAtMs,
            provider: selectedModel?.provider,
            model: selectedModel?.id,
            promptChars: prompt.length,
            promptHash: hashPrompt(prompt)
        });
        this.observer.turnStarted({
            turnId,
            sessionId,
            runId,
            turnKind: "naming",
            turnIndex: 0,
            startedAtMs,
            provider: selectedModel?.provider,
            model: selectedModel?.id,
            messageCount: 1
        });

        try {
            const result = await generateSessionNameResult(
                this.llm,
                this.config,
                prompt
            );
            const endedAtMs = Date.now();
            const durationMs = Math.round(performance.now() - startedAt);
            const usage = result.usage;
            this.observer.turnFinished(turnId, {
                endedAtMs,
                durationMs: result.durationMs,
                outcome: "completed",
                ttftMs: result.ttftMs,
                firstTokenKind: result.ttftMs === undefined ? undefined : "text",
                generationMs: result.generationMs,
                inputTokens: usage?.inputTokens,
                outputTokens: usage?.outputTokens,
                cacheReadTokens: usage?.cacheReadTokens,
                cacheWriteTokens: usage?.cacheWriteTokens,
                reasoningTokens: usage?.reasoningTokens,
                costUsd: usage?.cost,
                tokensPerSecond: tokensPerSecond(usage?.outputTokens, result.generationMs),
                wallTokensPerSecond: tokensPerSecond(usage?.outputTokens, result.durationMs),
                stopReason: result.stopReason,
                responseId: result.responseId,
                responseModel: result.responseModel,
                toolCalls: 0,
                receivedTextChars: result.receivedTextChars
            });
            turnFinished = true;

            const update = this.sessions.renameIfUnchanged(
                sessionId,
                currentName,
                result.name
            );
            if (update.renamed) {
                this.emit(sessionId, { type: "session.renamed", name: update.name });
            }
            this.observer.runFinished(runId, {
                endedAtMs: Date.now(),
                durationMs,
                outcome: "completed",
                provider: selectedModel?.provider,
                model: selectedModel?.id,
                activeDurationMs: durationMs,
                llmTurns: 1,
                toolCalls: 0,
                agentSteps: 0,
                llmDurationMs: result.durationMs,
                ttftMs: result.ttftMs,
                inputTokens: usage?.inputTokens,
                outputTokens: usage?.outputTokens,
                cacheReadTokens: usage?.cacheReadTokens,
                cacheWriteTokens: usage?.cacheWriteTokens,
                reasoningTokens: usage?.reasoningTokens,
                costUsd: usage?.cost,
                tokensPerSecond: tokensPerSecond(usage?.outputTokens, result.generationMs),
                wallTokensPerSecond: tokensPerSecond(usage?.outputTokens, durationMs),
                finalStopReason: result.stopReason,
                toolSequenceJson: "[]"
            });
            runFinished = true;
            this.logger.info("Session auto-naming completed", {
                sessionId,
                runId,
                renamed: update.renamed,
                durationMs: elapsedMs(startedAt)
            });
            return update.name;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const failedAtModelResolve = message === "No model configured"
                || message.startsWith("Model not found:");
            const timedOut = /timed out/i.test(message);
            const endedAtMs = Date.now();
            const durationMs = Math.round(performance.now() - startedAt);
            if (!turnFinished) {
                this.observer.turnFinished(turnId, {
                    endedAtMs,
                    durationMs,
                    outcome: "error",
                    toolCalls: 0,
                    errorCode: failedAtModelResolve
                        ? "naming_model_resolve"
                        : timedOut
                            ? "naming_timeout"
                            : "naming_failed",
                    errorMessage: message
                });
                turnFinished = true;
            }
            if (!runFinished) {
                this.observer.runFinished(runId, {
                    endedAtMs,
                    durationMs,
                    outcome: "failed",
                    provider: selectedModel?.provider,
                    model: selectedModel?.id,
                    activeDurationMs: durationMs,
                    errorStage: failedAtModelResolve
                        ? "model_resolve"
                        : timedOut
                            ? "naming_timeout"
                            : "naming",
                    errorCode: failedAtModelResolve
                        ? "naming_model_resolve"
                        : timedOut
                            ? "naming_timeout"
                            : "naming_failed",
                    errorMessage: message,
                    llmTurns: failedAtModelResolve ? 0 : 1,
                    llmDurationMs: failedAtModelResolve ? 0 : durationMs,
                    toolCalls: 0,
                    agentSteps: 0,
                    toolSequenceJson: "[]"
                });
                runFinished = true;
            }
            this.logger.error("Session auto-naming failed", error, {
                sessionId,
                runId,
                durationMs: elapsedMs(startedAt)
            });
            throw error;
        }
    }

    private emit(sessionId: string, event: JarvixEvent): void {
        for (const listener of this.listeners) {
            listener(event, sessionId);
        }
    }

    private snapshotSession(session: Session): JarvixSession {
        const snapshot = session.snapshot();
        const contextUsage = this.contextUsageFor(session);
        return contextUsage ? { ...snapshot, contextUsage } : snapshot;
    }

    private contextUsageFor(session: Session): JarvixContextUsage | undefined {
        const resolved = resolveConfiguredModel(
            this.config.providers,
            this.config.selectedModel
        );
        return resolved
            ? session.contextUsage(
                resolved.model.contextWindow,
                workingDirectoriesFor(session.meta)
            )
            : undefined;
    }

    private emitContextUsage(session: Session): void {
        const usage = this.contextUsageFor(session);
        if (usage) {
            this.emit(session.meta.id, { type: "context.usage", usage });
        }
    }

    private emitLoadedContextUsage(): void {
        for (const session of this.sessions.listLoaded()) {
            this.emitContextUsage(session);
        }
    }

    subscribe(listener: JarvixListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    async request(
        question: string,
        sessionId: string,
        sandboxPaths: readonly string[] = []
    ): Promise<void> {
        const session = this.sessions.require(sessionId);
        await session.request(question, {
            llm: this.llm,
            config: this.config,
            workingDirectories: workingDirectoriesFor(session.meta),
            emit: (event) => this.emit(session.meta.id, event)
        }, sandboxPaths);
    }

    injectPrompt(
        question: string,
        sessionId: string,
        promptId: string,
        sandboxPaths: readonly string[] = []
    ): boolean {
        const session = this.sessions.require(sessionId);
        const accepted = session.injectPrompt(question, promptId);
        if (accepted) {
            session.exemptSandboxPaths(sandboxPaths);
        }
        return accepted;
    }

    stopRequest(sessionId: string): void {
        this.sessions.require(sessionId).abort();
    }

    async shutdown(): Promise<void> {
        await this.sessions.shutdown();
    }

    dispose(): void {
        this.sessions.dispose();
    }
}

function selectedModelLabel(config: JarvixConfig): string | null {
    const selection = config.selectedModel;
    return selection ? `${selection.provider}/${selection.id}` : null;
}

function elapsedMs(startedAt: number): number {
    return Math.round((performance.now() - startedAt) * 10) / 10;
}

function hashPrompt(prompt: string): string {
    return createHash("sha256").update(prompt).digest("hex").slice(0, 16);
}

function tokensPerSecond(
    tokens: number | undefined,
    durationMs: number | undefined
): number | undefined {
    if (tokens === undefined || durationMs === undefined || durationMs <= 0) {
        return undefined;
    }
    return Math.round((tokens / (durationMs / 1_000)) * 100) / 100;
}
