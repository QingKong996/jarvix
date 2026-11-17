import type {
    JarvixSession,
    JarvixSessionContext,
    JarvixSessionSummary,
    JarvixSessionStatus
} from "../../protocol/session.ts";
import { sessionContextFrom } from "../../protocol/session.ts";
import type { PermissionMode } from "../../protocol/permission.ts";
import { loadProject } from "../../project/store.ts";
import { createSandboxPolicy } from "../permissions/sandbox.ts";
import { createDefaultTools } from "../tools/index.ts";
import { Session } from "./session.ts";
import {
    createSession,
    deleteSession,
    listArchivedSessionSummaries,
    listSessionSummaries,
    loadSession,
    updateSessionContext,
    updateSessionName,
    updateSessionPermission as updateStoredSessionPermission,
    updateSessionStatus
} from "./store.ts";

/** Owns the session instances currently loaded by the app. */
export class SessionManager {
    private readonly sessions = new Map<string, Session>();

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

    updateContext(id: string, context: JarvixSessionContext): JarvixSessionContext {
        const session = this.require(id);
        const meta = updateSessionContext(id, context);
        const updated = sessionContextFrom(meta);
        this.applyContext(session, updated);
        return updated;
    }

    updatePermission(id: string, permission: PermissionMode): PermissionMode {
        const session = this.require(id);
        if (session.meta.permission === permission) {
            return permission;
        }
        const meta = updateStoredSessionPermission(id, permission);
        session.applyPermission(meta.permission);
        return meta.permission;
    }

    rename(id: string, name: string): string {
        const session = this.require(id);
        const meta = updateSessionName(id, name);
        session.meta.name = meta.name;
        return meta.name;
    }

    updateStatus(id: string, status: JarvixSessionStatus): void {
        const session = this.require(id);
        const meta = updateSessionStatus(id, status);
        session.meta.status = meta.status;
        if (meta.archivedAt === undefined) {
            delete session.meta.archivedAt;
        } else {
            session.meta.archivedAt = meta.archivedAt;
        }
    }

    delete(id: string): void {
        const session = this.require(id);
        deleteSession(id);
        session.dispose();
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
        const directories = workingDirectories(session.meta);
        const sandboxPolicy = () => createSandboxPolicy(
            session.meta.permission,
            workingDirectories(session.meta)
        );
        const instance = new Session(
            session.meta,
            session.messages,
            createDefaultTools({
                shell: {
                    defaultCwd: directories[0],
                    sandboxPolicy
                },
                applyPatch: {
                    sandboxPolicy
                }
            })
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

function workingDirectories(meta: JarvixSession["meta"]): readonly string[] {
    if (meta.projectId) {
        return loadProject(meta.projectId)?.workingDirectories ?? [];
    }
    return meta.workingDirectory ? [meta.workingDirectory] : [];
}
