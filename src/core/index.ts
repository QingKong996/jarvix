import { createLlm, type LlmAdapter } from "../llm/index.ts";
import { i18n } from "../i18n/index.ts";
import type { JarvixConfig } from "../protocol/config.ts";
import type { JarvixContextUsage } from "../protocol/context-usage.ts";
import type { JarvixEvent, JarvixListener } from "../protocol/event.ts";
import type { JarvixProject } from "../protocol/project.ts";
import type { JarvixProviderContext } from "../protocol/provider-context.ts";
import type {
    JarvixSession,
    JarvixSessionContext,
    JarvixSessionSummary
} from "../protocol/session.ts";
import { sessionContextSchema, sessionNameSchema } from "../protocol/session.ts";
import { resolveConfiguredModel } from "../protocol/providers.ts";
import {
    DEFAULT_PERMISSION_MODE,
    type PermissionMode
} from "../protocol/permission.ts";
import type { SandboxPreflight } from "./permissions/sandbox-launch.ts";
import {
    createProject as createStoredProject,
    listProjects as listStoredProjects,
    loadProject
} from "../project/store.ts";
import { workingDirectoriesFor } from "./session/directories.ts";
import { SessionManager } from "./session/manager.ts";
import type { ContextManagerFactory } from "./session/runtime/context-manager.ts";
import type { Session } from "./session/runtime/session.ts";
import { generateSessionName } from "./session/naming.ts";

export {
    createDefaultContextManager,
    DefaultContextManager
} from "./session/runtime/context-manager.ts";
export type {
    ContextManager,
    ContextManagerFactory
} from "./session/runtime/context-manager.ts";

export type JarvixOptions = {
    llm?: LlmAdapter;
    config?: JarvixConfig;
    sandboxPreflight?: SandboxPreflight;
    contextManagerFactory?: ContextManagerFactory;
};

export class Jarvix {
    private readonly listeners = new Set<JarvixListener>();
    private config: JarvixConfig;
    private readonly llm: LlmAdapter;
    private readonly sessions: SessionManager;

    constructor(options: JarvixOptions = {}) {
        this.config = options.config ?? {};
        this.llm = options.llm ?? createLlm(() => this.config.providers);
        this.sessions = new SessionManager(
            options.sandboxPreflight,
            options.contextManagerFactory
        );
    }

    setConfig(config: JarvixConfig): void {
        this.config = config;
        for (const session of this.sessions.listLoaded()) {
            this.emitContextUsage(session);
        }
    }

    createProject(name: string, workingDirectories: readonly string[]): JarvixProject {
        return createStoredProject(name, workingDirectories);
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

    renameSession(sessionId: string, name: string): string {
        const renamed = this.sessions.rename(sessionId, sessionNameSchema.parse(name));
        this.emit(sessionId, { type: "session.renamed", name: renamed });
        return renamed;
    }

    async autoNameSession(sessionId: string, firstPrompt?: string): Promise<string> {
        const { currentName, prompt } = this.sessions.namingContext(
            sessionId,
            firstPrompt
        );
        if (!prompt) {
            throw new Error("The session has no user prompt to name");
        }

        const name = await generateSessionName(this.llm, this.config, prompt);
        const update = this.sessions.renameIfUnchanged(sessionId, currentName, name);
        if (update.renamed) {
            this.emit(sessionId, { type: "session.renamed", name: update.name });
        }
        return update.name;
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

    subscribe(listener: JarvixListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    async request(question: string, sessionId: string): Promise<void> {
        const session = this.sessions.require(sessionId);
        await session.request(question, {
            llm: this.llm,
            config: this.config,
            workingDirectories: workingDirectoriesFor(session.meta),
            emit: (event) => this.emit(session.meta.id, event)
        });
    }

    injectPrompt(question: string, sessionId: string, promptId: string): boolean {
        return this.sessions.require(sessionId).injectPrompt(question, promptId);
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
