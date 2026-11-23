import { useCallback, useRef, useState } from "react";
import type { JarvixContextUsage } from "../../protocol/context-usage.ts";
import {
    DEFAULT_PERMISSION_MODE,
    type PermissionMode,
    type PermissionRequest
} from "../../protocol/permission.ts";
import type { JarvixProject } from "../../protocol/project.ts";
import {
    sessionContextFrom,
    type JarvixSession,
    type JarvixSessionContext,
    type JarvixSessionSummary
} from "../../protocol/session.ts";
import { hydrate } from "./components/transcript/state/transcript-store.ts";
import {
    isCurrentPermissionRequest,
    type ActivePermissionRequest
} from "./permission-request-state.ts";
import { RequestEventGate } from "./request-event-gate.ts";
import {
    loadArchivedSessions,
    loadProjects,
    loadSessions
} from "./sessions/session-data.ts";
import { usePromptController } from "./sessions/use-prompt-controller.ts";
import { useSessionActions } from "./sessions/use-session-actions.ts";
import { useSessionEvents } from "./sessions/use-session-events.ts";

const bridge = window.jarvix;

/** Owns renderer-side session selection and request orchestration. */
export function useSessions() {
    const [projects, setProjects] = useState<JarvixProject[]>([]);
    const [sessions, setSessions] = useState<JarvixSessionSummary[]>([]);
    const [archivedSessions, setArchivedSessions] = useState<JarvixSessionSummary[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [sessionContext, setSessionContext] = useState<JarvixSessionContext>({});
    const [sessionPermission, setSessionPermission] = useState<PermissionMode>(
        DEFAULT_PERMISSION_MODE
    );
    const [contextUsage, setContextUsage] = useState<JarvixContextUsage | null>(null);
    const [providerContextRevision, setProviderContextRevision] = useState(0);
    const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null);
    const [busy, setBusy] = useState(false);
    const [running, setRunning] = useState(false);
    const [ready, setReady] = useState(false);
    const [requestEventGate] = useState(() => new RequestEventGate());
    const activeSessionIdRef = useRef<string | null>(null);
    const requestSessionIdRef = useRef<string | null>(null);
    const requestCompletionRef = useRef<Promise<void> | null>(null);
    const requestInFlightRef = useRef(false);
    const sessionContextRef = useRef<JarvixSessionContext>({});
    const sessionPermissionRef = useRef<PermissionMode>(DEFAULT_PERMISSION_MODE);
    const permissionRequestRef = useRef<ActivePermissionRequest | null>(null);
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

    const updatePermissionState = useCallback((permission: PermissionMode): void => {
        sessionPermissionRef.current = permission;
        setSessionPermission(permission);
    }, []);

    const clearPermissionRequest = useCallback((
        sessionId?: string,
        requestId?: string
    ): void => {
        const current = permissionRequestRef.current;
        if (!isCurrentPermissionRequest(current, sessionId, requestId)) {
            return;
        }
        permissionRequestRef.current = null;
        setPermissionRequest(null);
    }, []);

    const releaseSession = useCallback((sessionId: string | null): void => {
        if (!bridge || !sessionId) {
            return;
        }
        void bridge.releaseSession(sessionId).catch(() => undefined);
    }, []);

    const activateSession = useCallback((session: JarvixSession | null): void => {
        activeSessionIdRef.current = session?.meta.id ?? null;
        hasUserMessagesRef.current = session?.messages.some(
            (message) => (
                message.role === "user" &&
                message.context !== "compact"
            )
        ) ?? false;
        setActiveSessionId(session?.meta.id ?? null);
        updateContextState(session ? sessionContextFrom(session.meta) : {});
        updatePermissionState(session?.meta.permission ?? DEFAULT_PERMISSION_MODE);
        setContextUsage(session?.contextUsage ?? null);
        clearPermissionRequest();
        hydrate(session?.messages ?? []);
    }, [clearPermissionRequest, updateContextState, updatePermissionState]);

    const refreshSessions = useCallback(async (): Promise<void> => {
        const next = await loadSessions(bridge);
        if (next) {
            setSessions(next);
        }
    }, []);

    const refreshArchivedSessions = useCallback(async (): Promise<void> => {
        const next = await loadArchivedSessions(bridge);
        if (next) {
            setArchivedSessions(next);
        }
    }, []);

    const refreshProjects = useCallback(async (): Promise<void> => {
        const next = await loadProjects(bridge);
        if (next) {
            setProjects(next);
        }
    }, []);

    const actions = useSessionActions({
        bridge,
        ready,
        busy,
        setBusy,
        setActiveSessionId,
        setContextUsage,
        activeSessionIdRef,
        hasUserMessagesRef,
        permissionRequestRef,
        activateSession,
        clearPermissionRequest,
        releaseSession,
        updateContextState,
        updatePermissionState,
        updateSessionName,
        refreshProjects,
        refreshSessions,
        refreshArchivedSessions
    });

    useSessionEvents({
        bridge,
        activeSessionIdRef,
        permissionRequestRef,
        requestEventGate,
        activateSession,
        clearPermissionRequest,
        updateSessionName,
        setProjects,
        setSessions,
        setArchivedSessions,
        setContextUsage,
        setProviderContextRevision,
        setPermissionRequest,
        setReady
    });

    const { send, stop } = usePromptController({
        bridge,
        ready,
        busy,
        setBusy,
        setRunning,
        activeSessionIdRef,
        requestSessionIdRef,
        requestCompletionRef,
        requestInFlightRef,
        sessionContextRef,
        sessionPermissionRef,
        hasUserMessagesRef,
        requestEventGate,
        activateSession,
        clearPermissionRequest,
        refreshSessions
    });

    return {
        projects,
        sessions,
        archivedSessions,
        sessionContext,
        sessionPermission,
        contextUsage,
        providerContextRevision,
        permissionRequest,
        activeSessionId,
        busy,
        running,
        ready,
        ...actions,
        send,
        stop
    };
}
