import { useCallback, useEffect, useRef, useState } from "react";
import type { JarvixSession, JarvixSessionSummary } from "../../protocol/session.ts";
import { beginTurn, failRequest, hydrate, ingest } from "./transcript-store.ts";

const bridge = window.jarvix;

/** Owns renderer-side session selection and request orchestration. */
export function useSessions() {
    const [sessions, setSessions] = useState<JarvixSessionSummary[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [ready, setReady] = useState(false);
    const activeSessionIdRef = useRef<string | null>(null);

    const activateSession = useCallback((session: JarvixSession | null): void => {
        activeSessionIdRef.current = session?.meta.id ?? null;
        setActiveSessionId(session?.meta.id ?? null);
        hydrate(session?.messages ?? []);
    }, []);

    const refreshSessions = useCallback(async (): Promise<void> => {
        if (!bridge) {
            return;
        }
        try {
            setSessions(await bridge.listSessions());
        } catch {
            return;
        }
    }, []);

    useEffect(() => {
        if (!bridge) {
            setReady(true);
            return;
        }

        let cancelled = false;
        const unsubscribe = bridge.onEvents((batch) => {
            if (batch.sessionId === activeSessionIdRef.current) {
                ingest(batch.events);
            }
        });

        void (async () => {
            try {
                const summaries = await bridge.listSessions();
                if (cancelled) {
                    return;
                }
                setSessions(summaries);
                const latest = summaries[0];
                const session = latest ? await bridge.openSession(latest.id) : null;
                if (!cancelled) {
                    activateSession(session);
                }
            } catch {
                if (!cancelled) {
                    activateSession(null);
                }
            } finally {
                if (!cancelled) {
                    setReady(true);
                }
            }
        })();

        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, [activateSession]);

    const createSession = useCallback(async (): Promise<void> => {
        if (!bridge || !ready || busy) {
            return;
        }
        setBusy(true);
        try {
            activateSession(await bridge.createSession());
            await refreshSessions();
        } catch {
            return;
        } finally {
            setBusy(false);
        }
    }, [activateSession, busy, ready, refreshSessions]);

    const selectSession = useCallback(async (sessionId: string): Promise<void> => {
        if (!bridge || !ready || busy || sessionId === activeSessionIdRef.current) {
            return;
        }
        setBusy(true);
        try {
            const session = await bridge.openSession(sessionId);
            if (session) {
                activateSession(session);
            }
        } catch {
            return;
        } finally {
            setBusy(false);
        }
    }, [activateSession, busy, ready]);

    const send = useCallback(async (question: string): Promise<void> => {
        if (!bridge || !ready || busy) {
            return;
        }
        setBusy(true);

        try {
            let sessionId = activeSessionIdRef.current;
            if (!sessionId) {
                const session = await bridge.createSession();
                sessionId = session.meta.id;
                activateSession(session);
            }
            beginTurn(question);
            await bridge.request(question, sessionId);
        } catch (error) {
            failRequest(error instanceof Error ? error.message : String(error));
        } finally {
            setBusy(false);
            await refreshSessions();
        }
    }, [activateSession, busy, ready, refreshSessions]);

    return {
        sessions,
        activeSessionId,
        busy,
        ready,
        createSession,
        selectSession,
        send
    };
}
