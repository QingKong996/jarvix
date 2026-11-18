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
import { createSandboxPolicy } from "../permissions/sandbox.ts";
import { createDefaultTools } from "../tools/index.ts";
import { ShellSessionBudget } from "../tools/shell.ts";
import { workingDirectoriesFor } from "./directories.ts";
import { Session } from "./session.ts";
import {
    createSession,
    deleteSession,
    listArchivedSessionSummaries,
    listSessionSummaries,
    loadSession,
    updateSessionContext,
    updateSessionName,
    updateSessionNameIfUnchanged,
    updateSessionPermission as updateStoredSessionPermission,
    updateSessionStatus
} from "./store.ts";

/** Owns the session instances currently loaded by the app. */
export class SessionManager {
    private readonly sessions = new Map<string, Session>();
    private readonly sandboxPreflight?: SandboxPreflight;
    private readonly shellSessionBudget = new ShellSessionBudget();

    constructor(sandboxPreflight?: SandboxPreflight) {
        this.sandboxPreflight = sandboxPreflight;
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
        session?.applyPermission(meta.permission);
        return meta.permission;
    }

    respondPermission(id: string, requestId: string, approved: boolean): boolean {
        return this.require(id).respondPermission(
            requestId,
            approved ? "approved" : "cancelled"
        );
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
        deleteSession(id);
        session?.dispose();
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
    }

    private track(session: JarvixSession): Session {
        const permissions = new SessionPermissions();
        const sandboxPolicy = () => permissions.apply(createSandboxPolicy(
            session.meta.permission,
            workingDirectoriesFor(session.meta)
        ));
        const instance = new Session(
            session.meta,
            session.messages,
            createDefaultTools({
                shell: {
                    defaultCwd: () => workingDirectoriesFor(session.meta)[0],
                    sandboxPolicy,
                    sandboxPreflight: this.sandboxPreflight,
                    sharedBudget: this.shellSessionBudget
                },
                applyPatch: {
                    defaultCwd: () => workingDirectoriesFor(session.meta)[0],
                    sandboxPolicy
                },
                requestPermission: {
                    sandboxPolicy
                }
            }),
            permissions
        );
        this.sessions.set(instance.meta.id, instance);
        return instance;
    }

    private applyContext(session: Session, context: JarvixSessionContext): void {
        delete session.meta.projectId;
        delete session.meta.workingDirectory;
        Object.assign(session.meta, context);
    }
}
