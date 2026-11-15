import { useCallback, useEffect, useRef, useState } from "react";
import type { JarvixProject } from "../../protocol/project.ts";
import {
    sessionContextFrom,
    type JarvixSession,
    type JarvixSessionContext,
    type JarvixSessionSummary
} from "../../protocol/session.ts";
import { ingestBackgroundTasks } from "./background-task-store.ts";
import { beginTurn, failRequest, hydrate, ingest } from "./transcript-store.ts";

const bridge = window.jarvix;

/** Owns renderer-side session selection and request orchestration. */
export function useSessions() {
    const [projects, setProjects] = useState<JarvixProject[]>([]);
    const [sessions, setSessions] = useState<JarvixSessionSummary[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [sessionContext, setSessionContext] = useState<JarvixSessionContext>({});
    const [busy, setBusy] = useState(false);
    const [ready, setReady] = useState(false);
    const activeSessionIdRef = useRef<string | null>(null);
    const sessionContextRef = useRef<JarvixSessionContext>({});

    const updateContextState = useCallback((context: JarvixSessionContext): void => {
        sessionContextRef.current = context;
        setSessionContext(context);
    }, []);

    const activateSession = useCallback((session: JarvixSession | null): void => {
        activeSessionIdRef.current = session?.meta.id ?? null;
        setActiveSessionId(session?.meta.id ?? null);
        updateContextState(session ? sessionContextFrom(session.meta) : {});
        hydrate(session?.messages ?? []);
    }, [updateContextState]);

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

    const refreshProjects = useCallback(async (): Promise<void> => {
        if (!bridge) {
            return;
        }
        try {
            setProjects(await bridge.listProjects());
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
            ingestBackgroundTasks(batch.sessionId, batch.events);
            if (batch.sessionId === activeSessionIdRef.current) {
                ingest(batch.events);
            }
        });

        void (async () => {
            try {
                const [loadedProjects, summaries] = await Promise.all([
                    bridge.listProjects(),
                    bridge.listSessions()
                ]);
                if (cancelled) {
                    return;
                }
                setProjects(loadedProjects);
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

    const startNewSession = useCallback((projectId?: string | null): void => {
        if (!bridge || !ready || busy) {
            return;
        }
        activeSessionIdRef.current = null;
        setActiveSessionId(null);
        updateContextState(projectId ? { projectId } : {});
        hydrate([]);
    }, [busy, ready, updateContextState]);

    const createProject = useCallback(async (
        name: string,
        workingDirectories: string[]
    ): Promise<JarvixProject | null> => {
        if (!bridge || !ready || busy) {
            return null;
        }
        setBusy(true);
        try {
            const project = await bridge.createProject(name, workingDirectories);
            await refreshProjects();
            return project;
        } finally {
            setBusy(false);
        }
    }, [busy, ready, refreshProjects]);

    const moveSessionToProject = useCallback(async (
        sessionId: string,
        projectId: string | null
    ): Promise<void> => {
        if (!bridge || !ready || busy) {
            return;
        }
        setBusy(true);
        try {
            const context: JarvixSessionContext = projectId ? { projectId } : {};
            const updated = await bridge.updateSessionContext(sessionId, context);
            if (activeSessionIdRef.current === sessionId) {
                updateContextState(updated);
            }
            await refreshSessions();
        } catch {
            return;
        } finally {
            setBusy(false);
        }
    }, [busy, ready, refreshSessions, updateContextState]);

    const updateSessionContext = useCallback(async (context: JarvixSessionContext): Promise<void> => {
        if (!bridge || !ready || busy) {
            return;
        }
        const sessionId = activeSessionIdRef.current;
        if (!sessionId) {
            updateContextState(context);
            return;
        }

        setBusy(true);
        try {
            const updated = await bridge.updateSessionContext(sessionId, context);
            updateContextState(updated);
            await refreshSessions();
        } finally {
            setBusy(false);
        }
    }, [busy, ready, refreshSessions, updateContextState]);

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
            const sessionId = activeSessionIdRef.current;
            if (!sessionId) {
                const created = await bridge.createSession(sessionContextRef.current);
                activateSession(created);
                await refreshSessions();
                beginTurn(question);
                await bridge.request(question, created.meta.id);
            } else {
                beginTurn(question);
                await bridge.request(question, sessionId);
            }
        } catch (error) {
            failRequest(error instanceof Error ? error.message : String(error));
        } finally {
            setBusy(false);
            await refreshSessions();
        }
    }, [activateSession, busy, ready, refreshSessions]);

    return {
        projects,
        sessions,
        sessionContext,
        activeSessionId,
        busy,
        ready,
        createProject,
        startNewSession,
        updateSessionContext,
        moveSessionToProject,
        selectSession,
        send
    };
}
