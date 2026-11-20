import {
    useCallback,
    type Dispatch,
    type RefObject,
    type SetStateAction
} from "react";
import type { JarvixContextUsage } from "../../../protocol/context-usage.ts";
import type { JarvixBridge } from "../../../protocol/ipc.ts";
import {
    DEFAULT_PERMISSION_MODE,
    type PermissionMode
} from "../../../protocol/permission.ts";
import type { JarvixProject } from "../../../protocol/project.ts";
import type {
    JarvixSession,
    JarvixSessionContext
} from "../../../protocol/session.ts";
import { clearBackgroundTasks } from "../background-tasks/store.ts";
import { hydrate } from "../components/transcript/state/transcript-store.ts";
import type { ActivePermissionRequest } from "../permission-request-state.ts";

export type SessionActionsOptions = {
    bridge: JarvixBridge | undefined;
    ready: boolean;
    busy: boolean;
    setBusy: Dispatch<SetStateAction<boolean>>;
    setActiveSessionId: Dispatch<SetStateAction<string | null>>;
    setContextUsage: Dispatch<SetStateAction<JarvixContextUsage | null>>;
    activeSessionIdRef: RefObject<string | null>;
    hasUserMessagesRef: RefObject<boolean>;
    sessionContextRef: RefObject<JarvixSessionContext>;
    sessionPermissionRef: RefObject<PermissionMode>;
    permissionRequestRef: RefObject<ActivePermissionRequest | null>;
    activateSession: (session: JarvixSession | null) => void;
    clearPermissionRequest: (sessionId?: string, requestId?: string) => void;
    releaseSession: (sessionId: string | null) => void;
    updateContextState: (context: JarvixSessionContext) => void;
    updatePermissionState: (permission: PermissionMode) => void;
    updateSessionName: (sessionId: string, name: string) => void;
    refreshProjects: () => Promise<void>;
    refreshSessions: () => Promise<void>;
    refreshArchivedSessions: () => Promise<void>;
};

export function useSessionActions(options: SessionActionsOptions) {
    const {
        bridge,
        ready,
        busy,
        setBusy,
        setActiveSessionId,
        setContextUsage,
        activeSessionIdRef,
        hasUserMessagesRef,
        sessionContextRef,
        sessionPermissionRef,
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
    } = options;

    const startNewSession = useCallback((projectId?: string | null): void => {
        if (!bridge || !ready || busy) {
            return;
        }
        const previousSessionId = activeSessionIdRef.current;
        activeSessionIdRef.current = null;
        hasUserMessagesRef.current = false;
        setActiveSessionId(null);
        clearPermissionRequest();
        updateContextState(projectId ? { projectId } : {});
        updatePermissionState(DEFAULT_PERMISSION_MODE);
        setContextUsage(null);
        hydrate([]);
        releaseSession(previousSessionId);
    }, [
        activeSessionIdRef,
        bridge,
        busy,
        clearPermissionRequest,
        hasUserMessagesRef,
        ready,
        releaseSession,
        setActiveSessionId,
        setContextUsage,
        updateContextState,
        updatePermissionState
    ]);

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
    }, [bridge, busy, ready, refreshProjects, setBusy]);

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
    }, [
        activeSessionIdRef,
        bridge,
        busy,
        ready,
        refreshSessions,
        setBusy,
        updateContextState
    ]);

    const updateSessionContext = useCallback(async (
        context: JarvixSessionContext
    ): Promise<void> => {
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
    }, [
        activeSessionIdRef,
        bridge,
        busy,
        ready,
        refreshSessions,
        setBusy,
        updateContextState
    ]);

    const updateSessionPermission = useCallback(async (
        permission: PermissionMode
    ): Promise<void> => {
        if (!bridge || !ready) {
            return;
        }
        const sessionId = activeSessionIdRef.current;
        if (!sessionId) {
            updatePermissionState(permission);
            return;
        }

        const updated = await bridge.setPermission(sessionId, permission);
        if (activeSessionIdRef.current === sessionId) {
            updatePermissionState(updated);
        }
    }, [
        activeSessionIdRef,
        bridge,
        ready,
        updatePermissionState
    ]);

    const respondPermission = useCallback(async (approved: boolean): Promise<boolean> => {
        const current = permissionRequestRef.current;
        if (!bridge || !current) {
            return false;
        }
        try {
            const responded = await bridge.respondPermission(
                current.sessionId,
                current.request.id,
                approved
            );
            if (responded) {
                clearPermissionRequest(current.sessionId, current.request.id);
            }
            return responded;
        } catch {
            return false;
        }
    }, [bridge, clearPermissionRequest, permissionRequestRef]);

    const renameSession = useCallback(async (
        sessionId: string,
        name: string
    ): Promise<boolean> => {
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
    }, [bridge, busy, ready, setBusy, updateSessionName]);

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
    }, [bridge, busy, ready, setBusy, updateSessionName]);

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
            releaseSession(sessionId);
            await Promise.all([refreshSessions(), refreshArchivedSessions()]);
            return true;
        } catch {
            return false;
        } finally {
            setBusy(false);
        }
    }, [
        activateSession,
        activeSessionIdRef,
        bridge,
        busy,
        ready,
        refreshArchivedSessions,
        refreshSessions,
        releaseSession,
        setBusy
    ]);

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
    }, [
        bridge,
        busy,
        ready,
        refreshArchivedSessions,
        refreshSessions,
        setBusy
    ]);

    const deleteSession = useCallback(async (sessionId: string): Promise<boolean> => {
        if (!bridge || !ready || busy) {
            return false;
        }
        setBusy(true);
        try {
            await bridge.deleteSession(sessionId);
            clearBackgroundTasks(sessionId);
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
    }, [
        activateSession,
        activeSessionIdRef,
        bridge,
        busy,
        ready,
        refreshArchivedSessions,
        refreshSessions,
        setBusy
    ]);

    const selectSession = useCallback(async (sessionId: string): Promise<void> => {
        if (!bridge || !ready || busy || sessionId === activeSessionIdRef.current) {
            return;
        }
        setBusy(true);
        try {
            const previousSessionId = activeSessionIdRef.current;
            const session = await bridge.openSession(sessionId);
            if (session) {
                activateSession(session);
                releaseSession(previousSessionId);
            }
        } catch {
            return;
        } finally {
            setBusy(false);
        }
    }, [
        activateSession,
        activeSessionIdRef,
        bridge,
        busy,
        ready,
        releaseSession,
        setBusy
    ]);

    return {
        createProject,
        startNewSession,
        updateSessionContext,
        updateSessionPermission,
        respondPermission,
        renameSession,
        autoNameSession,
        archiveSession,
        unarchiveSession,
        deleteSession,
        moveSessionToProject,
        selectSession
    };
}
