import type {
    JarvixSession,
    JarvixSessionContext,
    JarvixSessionSummary
} from "../protocol/session.ts";
import { sessionContextFrom } from "../protocol/session.ts";
import { Session } from "./session.ts";
import {
    createSession,
    listSessionSummaries,
    loadSession,
    updateSessionContext
} from "./store.ts";

/** Owns the session instances currently loaded by the app. */
export class SessionManager {
    private readonly sessions = new Map<string, Session>();

    create(context: JarvixSessionContext = {}, name?: string): Session {
        return this.track(createSession(context, name));
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

    updateContext(id: string, context: JarvixSessionContext): JarvixSessionContext {
        const session = this.require(id);
        const meta = updateSessionContext(id, context);
        const updated = sessionContextFrom(meta);
        this.applyContext(session, updated);
        return updated;
    }

    require(id: string): Session {
        const session = this.load(id);
        if (!session) {
            throw new Error(`Session not found: ${id}`);
        }
        return session;
    }

    dispose(): void {
        for (const session of this.sessions.values()) {
            session.dispose();
        }
        this.sessions.clear();
    }

    private track(session: JarvixSession): Session {
        const instance = new Session(session.meta, session.messages);
        this.sessions.set(instance.meta.id, instance);
        return instance;
    }

    private applyContext(session: Session, context: JarvixSessionContext): void {
        delete session.meta.projectId;
        delete session.meta.workingDirectory;
        Object.assign(session.meta, context);
    }
}
