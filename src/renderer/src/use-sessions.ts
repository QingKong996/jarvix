import { useCallback, useEffect, useRef, useState } from "react";
import type { JarvixProject } from "../../protocol/project.ts";
import {
    sessionContextFrom,
    type JarvixSession,
    type JarvixSessionContext,
    type JarvixSessionSummary
} from "../../protocol/session.ts";
import { ingestBackgroundTasks } from "./components/transcript/tools/background-task-store.ts";
import { RequestEventGate } from "./request-event-gate.ts";
import {
    beginTurn,
    discardInjectedPrompt,
    failRequest,
    finishRequest,
    hydrate,
    ingest,
    injectUserPrompt,
    stopTurn
} from "./components/transcript/transcript-store.ts";

const bridge = window.jarvix;

/** Owns renderer-side session selection and request orchestration. */
export function useSessions() {
    const [projects, setProjects] = useState<JarvixProject[]>([]);
    const [sessions, setSessions] = useState<JarvixSessionSummary[]>([]);
    const [archivedSessions, setArchivedSessions] = useState<JarvixSessionSummary[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [sessionContext, setSessionContext] = useState<JarvixSessionContext>({});
    const [busy, setBusy] = useState(false);
    const [running, setRunning] = useState(false);
    const [ready, setReady] = useState(false);
    const [requestEventGate] = useState(() => new RequestEventGate());
    const activeSessionIdRef = useRef<string | null>(null);
    const requestSessionIdRef = useRef<string | null>(null);
    const requestCompletionRef = useRef<Promise<void> | null>(null);
    const requestInFlightRef = useRef(false);
    const sessionContextRef = useRef<JarvixSessionContext>({});
    const hasUserMessagesRef = useRef(false);

    const updateContextState = useCallback((context: JarvixSessionContext): void => {
        sessionContextRef.current = context;
        setSessionContext(context);
    }, []);

    const updateSessionName = useCallback((sessionId: string, name: string): void => {
        setSessions((current) => current.map((session) => (
            session.id === sessionId ? { ...session, name } : session
        )));
    }, []);

    const activateSession = useCallback((session: JarvixSession | null): void => {
        activeSessionIdRef.current = session?.meta.id ?? null;
        hasUserMessagesRef.current = session?.messages.some((message) => message.role === "user") ?? false;
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

    const refreshArchivedSessions = useCallback(async (): Promise<void> => {
        if (!bridge) {
            return;
        }
        try {
            setArchivedSessions(await bridge.listArchivedSessions());
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
            const events = requestEventGate.filter(batch.sessionId, batch.events);
            if (events.length === 0) {
                return;
            }
            ingestBackgroundTasks(batch.sessionId, events);
            for (const event of events) {
                if (event.type === "session.renamed") {
                    updateSessionName(batch.sessionId, event.name);
                    break;
                }
            }
            if (batch.sessionId === activeSessionIdRef.current) {
                ingest(events);
            }
        });

        void (async () => {
            try {
                const [loadedProjects, summaries, archived] = await Promise.all([
                    bridge.listProjects(),
                    bridge.listSessions(),
                    bridge.listArchivedSessions()
                ]);
                if (cancelled) {
                    return;
                }
                setProjects(loadedProjects);
                setSessions(summaries);
                setArchivedSessions(archived);
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
    }, [activateSession, requestEventGate, updateSessionName]);

    const startNewSession = useCallback((projectId?: string | null): void => {
        if (!bridge || !ready || busy) {
            return;
        }
        activeSessionIdRef.current = null;
        hasUserMessagesRef.current = false;
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

    const renameSession = useCallback(async (sessionId: string, name: string): Promise<boolean> => {
        if (!bridge || !ready || busy) {
            return false;
        }
        setBusy(true);
        try {
            const renamed = await bridge.renameSession(sessionId, name);
            updateSessionName(sessionId, renamed);
            return true;
        } catch {
            return false;
        } finally {
            setBusy(false);
        }
    }, [busy, ready, updateSessionName]);

    const autoNameSession = useCallback(async (sessionId: string): Promise<boolean> => {
        if (!bridge || !ready || busy) {
            return false;
        }
        setBusy(true);
        try {
            const name = await bridge.autoNameSession(sessionId);
            updateSessionName(sessionId, name);
            return true;
        } catch {
            return false;
        } finally {
            setBusy(false);
        }
    }, [busy, ready, updateSessionName]);

    const archiveSession = useCallback(async (sessionId: string): Promise<boolean> => {
        if (!bridge || !ready || busy) {
            return false;
        }
        setBusy(true);
        try {
            await bridge.archiveSession(sessionId);
            if (activeSessionIdRef.current === sessionId) {
                activateSession(null);
            }
            await Promise.all([refreshSessions(), refreshArchivedSessions()]);
            return true;
        } catch {
            return false;
        } finally {
            setBusy(false);
        }
    }, [activateSession, busy, ready, refreshArchivedSessions, refreshSessions]);

    const unarchiveSession = useCallback(async (sessionId: string): Promise<boolean> => {
        if (!bridge || !ready || busy) {
            return false;
        }
        setBusy(true);
        try {
            await bridge.unarchiveSession(sessionId);
            await Promise.all([refreshSessions(), refreshArchivedSessions()]);
            return true;
        } catch {
            return false;
        } finally {
            setBusy(false);
        }
    }, [busy, ready, refreshArchivedSessions, refreshSessions]);

    const deleteSession = useCallback(async (sessionId: string): Promise<boolean> => {
        if (!bridge || !ready || busy) {
            return false;
        }
        setBusy(true);
        try {
            await bridge.deleteSession(sessionId);
            if (activeSessionIdRef.current === sessionId) {
                activateSession(null);
            }
            await Promise.all([refreshSessions(), refreshArchivedSessions()]);
            return true;
        } catch {
            return false;
        } finally {
            setBusy(false);
        }
    }, [activateSession, busy, ready, refreshArchivedSessions, refreshSessions]);

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

    const runPrompt = useCallback(async (
        question: string,
        initialSessionId: string | null
    ): Promise<void> => {
        if (!bridge) {
            return;
        }
        setBusy(true);
        let naming: Promise<unknown> | undefined;
        let sessionId = initialSessionId;

        try {
            const shouldAutoName = !hasUserMessagesRef.current;
            if (!sessionId) {
                const created = await bridge.createSession(sessionContextRef.current);
                activateSession(created);
                await refreshSessions();
                sessionId = created.meta.id;
            }
            requestSessionIdRef.current = sessionId;
            requestEventGate.resume(sessionId);
            setRunning(true);
            beginTurn(question);
            hasUserMessagesRef.current = true;
            if (shouldAutoName) {
                naming = bridge.autoNameSession(sessionId, question).catch(() => undefined);
            }
            try {
                await bridge.request(question, sessionId);
            } catch (error) {
                failRequest(error instanceof Error ? error.message : String(error));
            }
        } catch (error) {
            failRequest(error instanceof Error ? error.message : String(error));
        } finally {
            finishRequest();
            requestSessionIdRef.current = null;
            setRunning(false);
            await naming;
            requestInFlightRef.current = false;
            setBusy(false);
            await refreshSessions();
        }
    }, [activateSession, refreshSessions, requestEventGate]);

    const startRequest = useCallback(async (
        question: string,
        sessionId: string | null
    ): Promise<void> => {
        requestInFlightRef.current = true;
        const request = runPrompt(question, sessionId);
        requestCompletionRef.current = request;
        try {
            await request;
        } finally {
            if (requestCompletionRef.current === request) {
                requestCompletionRef.current = null;
            }
        }
    }, [runPrompt]);

    const send = useCallback(async (question: string): Promise<void> => {
        const normalized = question.trim();
        if (!normalized || !bridge || !ready) {
            return;
        }
        const activeRequestSessionId = requestSessionIdRef.current;
        if (activeRequestSessionId) {
            const promptId = injectUserPrompt(normalized);
            try {
                if (await bridge.injectPrompt(normalized, activeRequestSessionId, promptId)) {
                    return;
                }
            } catch (error) {
                discardInjectedPrompt(promptId);
                failRequest(error instanceof Error ? error.message : String(error));
                return;
            }
            discardInjectedPrompt(promptId);
            await requestCompletionRef.current?.catch(() => undefined);
            if (requestInFlightRef.current) {
                return;
            }
            await startRequest(normalized, activeSessionIdRef.current);
            return;
        }
        if (busy || requestInFlightRef.current) {
            return;
        }
        await startRequest(normalized, activeSessionIdRef.current);
    }, [busy, ready, startRequest]);

    const stop = useCallback(async (): Promise<void> => {
        const sessionId = requestSessionIdRef.current;
        if (!bridge || !sessionId) {
            return;
        }
        stopTurn();
        requestEventGate.pause(sessionId);
        setRunning(false);
        try {
            await bridge.stopRequest(sessionId);
        } catch {
            requestEventGate.cancelPause(sessionId);
            setRunning(true);
            return;
        }
    }, [requestEventGate]);

    return {
        projects,
        sessions,
        archivedSessions,
        sessionContext,
        activeSessionId,
        busy,
        running,
        ready,
        createProject,
        startNewSession,
        updateSessionContext,
        renameSession,
        autoNameSession,
        archiveSession,
        unarchiveSession,
        deleteSession,
        moveSessionToProject,
        selectSession,
        send,
        stop
    };
}
