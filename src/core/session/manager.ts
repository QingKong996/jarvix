import type {
    JarvixSession,
    JarvixSessionContext,
    JarvixSessionSummary,
    JarvixSessionStatus
} from "../../protocol/session.ts";
import { sessionContextFrom } from "../../protocol/session.ts";
import type { PermissionMode } from "../../protocol/permission.ts";
import { type JarvixLogger, noopLogger } from "../logger.ts";
import {
    noopAgentObserver,
    type AgentObserver
} from "../observability/index.ts";
import type { ToolSandboxFactory } from "../execution/sandbox.ts";
import { SessionPermissions } from "../permissions/session-permissions.ts";
import {
    createDefaultToolManager,
    createGoalToolManager,
    DEFAULT_TOOL_MANAGER_ID,
    GOAL_TOOL_MANAGER_ID,
    ShellSessionBudget,
    ToolManagerRegistry,
    type ToolManager
} from "../../runtime/tools/index.ts";
import {
    createDefaultContextManager,
    type ContextManagerFactory
} from "./runtime/context-manager.ts";
import { workingDirectoriesFor } from "./directories.ts";
import { Session } from "./runtime/session.ts";
import {
    createSession,
    deleteSession,
    listArchivedSessionSummaries,
    listSessionSummaries,
    loadSession,
    readSessionNamingContext,
    updateSessionContext,
    updateSessionName,
    updateSessionNameIfUnchanged,
    updateSessionPermission as updateStoredSessionPermission,
    updateSessionStatus
} from "./persistence/store.ts";
import type { LlmUserMessage } from "../../protocol/llm.ts";

/** Owns the session instances currently loaded by the app. */
export class SessionManager {
    private readonly sessions = new Map<string, Session>();
    private readonly permissions = new Map<string, SessionPermissions>();
    private readonly sandboxFactory?: ToolSandboxFactory;
    private readonly contextManagerFactory: ContextManagerFactory;
    private readonly toolManagers = new Map<string, ToolManager>();
    private readonly shellSessionBudget = new ShellSessionBudget();
    private readonly logger: JarvixLogger;
    private readonly observer: AgentObserver;

    constructor(
        sandboxFactory?: ToolSandboxFactory,
        contextManagerFactory: ContextManagerFactory = createDefaultContextManager,
        toolManagers: readonly ToolManager[] = [],
        logger: JarvixLogger = noopLogger,
        observer: AgentObserver = noopAgentObserver
    ) {
        this.sandboxFactory = sandboxFactory;
        this.contextManagerFactory = contextManagerFactory;
        this.logger = logger;
        this.observer = observer;
        for (const manager of toolManagers) {
            this.assertToolManagerAvailable(manager.id);
            this.toolManagers.set(manager.id, manager);
        }
    }

    create(
        context: JarvixSessionContext = {},
        name?: string,
        permission?: PermissionMode
    ): Session {
        const session = this.track(createSession(context, name, undefined, permission));
        this.logger.info("Session created", {
            sessionId: session.meta.id,
            permission: session.meta.permission,
            projectId: session.meta.projectId,
            hasWorkingDirectory: session.meta.workingDirectory !== undefined
        });
        return session;
    }

    load(id: string): Session | null {
        const cached = this.sessions.get(id);
        if (cached) {
            this.logger.debug("Returning cached session", { sessionId: id });
            return cached;
        }

        const stored = loadSession(id);
        if (!stored) {
            this.logger.warn("Session could not be loaded", { sessionId: id });
            return null;
        }
        const session = this.track(stored);
        this.logger.info("Session loaded", { sessionId: id });
        return session;
    }

    listSummaries(): JarvixSessionSummary[] {
        return listSessionSummaries();
    }

    listArchivedSummaries(): JarvixSessionSummary[] {
        return listArchivedSessionSummaries();
    }

    listLoaded(): readonly Session[] {
        return [...this.sessions.values()];
    }

    namingContext(
        id: string,
        firstPrompt?: string
    ): { currentName: string; prompt: string | undefined } {
        const prompt = firstPrompt?.trim();
        const loaded = this.sessions.get(id);
        if (loaded) {
            return {
                currentName: loaded.meta.name,
                prompt: prompt || loaded.snapshot().messages.find(
                    (message): message is LlmUserMessage => (
                        message.role === "user" &&
                        message.context !== "system-reminder" &&
                        message.context !== "compact"
                    )
                )?.content
            };
        }

        const stored = readSessionNamingContext(id);
        if (!stored) {
            throw new Error(`Session not found: ${id}`);
        }
        return {
            currentName: stored.name,
            prompt: prompt || stored.firstPrompt || undefined
        };
    }

    getLoaded(id: string): Session | undefined {
        return this.sessions.get(id);
    }

    releaseIfIdle(id: string): boolean {
        const session = this.sessions.get(id);
        if (!session || !session.release()) {
            this.logger.debug("Session could not be released", { sessionId: id });
            return false;
        }
        this.sessions.delete(id);
        this.logger.info("Session released from memory", { sessionId: id });
        return true;
    }

    updateContext(id: string, context: JarvixSessionContext): JarvixSessionContext {
        const meta = updateSessionContext(id, context);
        const updated = sessionContextFrom(meta);
        const session = this.sessions.get(id);
        if (session) {
            this.applyContext(session, updated);
        }
        this.logger.info("Session context updated", {
            sessionId: id,
            projectId: updated.projectId,
            hasWorkingDirectory: updated.workingDirectory !== undefined
        });
        return updated;
    }

    updatePermission(id: string, permission: PermissionMode): PermissionMode {
        const session = this.sessions.get(id);
        if (session?.meta.permission === permission) {
            return permission;
        }
        const meta = updateStoredSessionPermission(id, permission);
        if (session) {
            session.applyPermission(meta.permission);
        } else {
            this.permissions.get(id)?.reset();
        }
        this.logger.info("Session permission updated", {
            sessionId: id,
            permission: meta.permission
        });
        return meta.permission;
    }

    respondPermission(id: string, requestId: string, approved: boolean): boolean {
        return this.require(id).respondPermission(
            requestId,
            approved ? "approved" : "cancelled"
        );
    }

    async registerToolManager(manager: ToolManager): Promise<void> {
        this.logger.info("Registering tool manager", {
            toolManagerId: manager.id
        });
        this.assertToolManagerAvailable(manager.id);
        this.toolManagers.set(manager.id, manager);

        const registered: Session[] = [];
        try {
            for (const session of this.sessions.values()) {
                session.registerToolManager(manager);
                registered.push(session);
            }
        } catch (error) {
            this.toolManagers.delete(manager.id);
            await Promise.allSettled(
                registered.map((session) => session.unregisterToolManager(manager.id))
            );
            manager.dispose?.();
            this.logger.error("Failed to register tool manager", error, {
                toolManagerId: manager.id
            });
            throw error;
        }
    }

    async unregisterToolManager(managerId: string): Promise<boolean> {
        const manager = this.toolManagers.get(managerId);
        if (!manager) {
            this.logger.warn("Tool manager is not registered", {
                toolManagerId: managerId
            });
            return false;
        }
        this.toolManagers.delete(managerId);

        const results = await Promise.allSettled(
            [...this.sessions.values()].map(
                (session) => session.unregisterToolManager(managerId)
            )
        );
        manager.dispose?.();

        const failed = results.find(
            (result): result is PromiseRejectedResult => result.status === "rejected"
        );
        if (failed) {
            this.logger.error("Failed to unregister tool manager", failed.reason, {
                toolManagerId: managerId
            });
            throw failed.reason;
        }
        this.logger.info("Tool manager unregistered", {
            toolManagerId: managerId
        });
        return true;
    }

    rename(id: string, name: string): string {
        const meta = updateSessionName(id, name);
        const session = this.sessions.get(id);
        if (session) {
            session.meta.name = meta.name;
        }
        this.logger.info("Session renamed", { sessionId: id });
        return meta.name;
    }

    renameIfUnchanged(
        id: string,
        expectedName: string,
        name: string
    ): { name: string; renamed: boolean } {
        const update = updateSessionNameIfUnchanged(id, expectedName, name);
        if (update.updated) {
            const session = this.sessions.get(id);
            if (session) {
                session.meta.name = update.meta.name;
            }
            this.logger.info("Session auto-renamed", { sessionId: id });
        }
        return { name: update.meta.name, renamed: update.updated };
    }

    updateStatus(id: string, status: JarvixSessionStatus): void {
        const meta = updateSessionStatus(id, status);
        const session = this.sessions.get(id);
        if (session) {
            session.meta.status = meta.status;
            if (meta.archivedAt === undefined) {
                delete session.meta.archivedAt;
            } else {
                session.meta.archivedAt = meta.archivedAt;
            }
        }
        this.logger.info("Session status updated", { sessionId: id, status });
    }

    delete(id: string): void {
        const session = this.sessions.get(id);
        const permissions = this.permissions.get(id);
        deleteSession(id);
        session?.dispose();
        permissions?.dispose();
        this.permissions.delete(id);
        this.sessions.delete(id);
        this.logger.info("Session deleted", { sessionId: id });
    }

    require(id: string): Session {
        const session = this.load(id);
        if (!session) {
            throw new Error(`Session not found: ${id}`);
        }
        return session;
    }

    async shutdown(): Promise<void> {
        const sessions = [...this.sessions.values()];
        this.logger.info("Shutting down loaded sessions", {
            sessionCount: sessions.length
        });
        const results = await Promise.allSettled(
            sessions.map((session) => session.shutdown())
        );
        this.sessions.clear();
        this.disposePermissions();
        this.disposeToolManagers();
        const failed = results.find(
            (result): result is PromiseRejectedResult => result.status === "rejected"
        );
        if (failed) {
            this.logger.error("Failed to shut down a session", failed.reason);
            throw failed.reason;
        }
        this.logger.info("Loaded sessions shut down", {
            sessionCount: sessions.length
        });
    }

    dispose(): void {
        for (const session of this.sessions.values()) {
            session.dispose();
        }
        this.sessions.clear();
        this.disposePermissions();
        this.disposeToolManagers();
    }

    private track(session: JarvixSession): Session {
        const existingPermissions = this.permissions.get(session.meta.id);
        const permissions = existingPermissions
            ?? new SessionPermissions();
        this.permissions.set(session.meta.id, permissions);
        const tools = new ToolManagerRegistry({
            sessionId: session.meta.id,
            permission: () => session.meta.permission,
            workingDirectories: () => workingDirectoriesFor(session.meta)
        });
        let instance: Session;
        try {
            tools.registerManager(createDefaultToolManager({
                permissions,
                sandboxFactory: this.sandboxFactory,
                sharedBudget: this.shellSessionBudget
            }));
            for (const manager of this.toolManagers.values()) {
                tools.registerManager(manager);
            }
            instance = new Session(
                session.meta,
                session.messages,
                tools,
                permissions,
                this.contextManagerFactory,
                this.logger,
                this.observer
            );
            tools.registerManager(createGoalToolManager({
                getGoal: () => instance.meta.goal?.content,
                updateGoal: (content) => {
                    instance.setGoal(content);
                },
                finishGoal: (signal) => instance.finishGoal(signal)
            }));
            instance.initializeContext(workingDirectoriesFor(session.meta));
        } catch (error) {
            tools.dispose();
            if (!existingPermissions) {
                permissions.dispose();
                this.permissions.delete(session.meta.id);
            }
            throw error;
        }
        this.sessions.set(instance.meta.id, instance);
        return instance;
    }

    private disposePermissions(): void {
        for (const permissions of this.permissions.values()) {
            permissions.dispose();
        }
        this.permissions.clear();
    }

    private disposeToolManagers(): void {
        for (const manager of this.toolManagers.values()) {
            manager.dispose?.();
        }
        this.toolManagers.clear();
    }

    private assertToolManagerAvailable(managerId: string): void {
        if (
            managerId === DEFAULT_TOOL_MANAGER_ID ||
            managerId === GOAL_TOOL_MANAGER_ID
        ) {
            throw new Error(`Tool manager id is reserved: ${managerId}`);
        }
        if (this.toolManagers.has(managerId)) {
            throw new Error(`Tool manager already registered: ${managerId}`);
        }
    }

    private applyContext(session: Session, context: JarvixSessionContext): void {
        delete session.meta.projectId;
        delete session.meta.workingDirectory;
        Object.assign(session.meta, context);
    }
}
