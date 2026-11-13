import type { JarvixSession, JarvixSessionSummary } from "../protocol/session.ts";
import { Session } from "./session.ts";
import { createSession, listSessionSummaries, loadSession } from "./store.ts";

/** Owns the session instances currently loaded by the app. */
export class SessionManager {
    private readonly sessions = new Map<string, Session>();

    create(name?: string): Session {
        return this.track(createSession(name));
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

    require(id: string): Session {
        const session = this.load(id);
        if (!session) {
            throw new Error(`Session not found: ${id}`);
        }
        return session;
    }

    private track(session: JarvixSession): Session {
        const instance = new Session(session.meta, session.messages);
        this.sessions.set(instance.meta.id, instance);
        return instance;
    }
}
