import type {
    JarvixSession,
    JarvixSessionContext,
    JarvixSessionSummary,
    JarvixSessionStatus
} from "../../protocol/session.ts";
import { sessionContextFrom } from "../../protocol/session.ts";
import type { PermissionMode } from "../../protocol/permission.ts";
import type { SandboxPreflight } from "../permissions/sandbox-launch.ts";
import { SessionPermissions } from "../permissions/session-permissions.ts";
import {
    ToolManagerRegistry,
    type ToolManager
} from "../../runtime/tools/index.ts";
import {
    createDefaultToolManager,
    DEFAULT_TOOL_MANAGER_ID,
    ShellSessionBudget
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
    private readonly sandboxPreflight?: SandboxPreflight;
    private readonly contextManagerFactory: ContextManagerFactory;
    private readonly toolManagers = new Map<string, ToolManager>();
    private readonly shellSessionBudget = new ShellSessionBudget();

    constructor(
        sandboxPreflight?: SandboxPreflight,
        contextManagerFactory: ContextManagerFactory = createDefaultContextManager,
        toolManagers: readonly ToolManager[] = []
    ) {
        this.sandboxPreflight = sandboxPreflight;
        this.contextManagerFactory = contextManagerFactory;
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
        return this.track(createSession(context, name, undefined, permission));
    }

    load(id: string): Session | null {
        const cached = this.sessions.get(id);
        if (cached) {
            return cached;
        }

        const stored = loadSession(id);
        return stored ? this.track(stored) : null;
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
            return false;
        }
        this.sessions.delete(id);
        return true;
    }

    updateContext(id: string, context: JarvixSessionContext): JarvixSessionContext {
        const meta = updateSessionContext(id, context);
        const updated = sessionContextFrom(meta);
        const session = this.sessions.get(id);
        if (session) {
            this.applyContext(session, updated);
        }
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
        return meta.permission;
    }

    respondPermission(id: string, requestId: string, approved: boolean): boolean {
        return this.require(id).respondPermission(
            requestId,
            approved ? "approved" : "cancelled"
        );
    }

    async registerToolManager(manager: ToolManager): Promise<void> {
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
            throw error;
        }
    }

    async unregisterToolManager(managerId: string): Promise<boolean> {
        const manager = this.toolManagers.get(managerId);
        if (!manager) {
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
            throw failed.reason;
        }
        return true;
    }

    rename(id: string, name: string): string {
        const meta = updateSessionName(id, name);
        const session = this.sessions.get(id);
        if (session) {
            session.meta.name = meta.name;
        }
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
    }

    delete(id: string): void {
        const session = this.sessions.get(id);
        const permissions = this.permissions.get(id);
        deleteSession(id);
        session?.dispose();
        permissions?.dispose();
        this.permissions.delete(id);
        this.sessions.delete(id);
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
            throw failed.reason;
        }
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
                sandboxPreflight: this.sandboxPreflight,
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
                this.contextManagerFactory
            );
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
        if (managerId === DEFAULT_TOOL_MANAGER_ID) {
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
