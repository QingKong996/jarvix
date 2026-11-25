import {
    useEffect,
    type Dispatch,
    type RefObject,
    type SetStateAction
} from "react";
import type { JarvixContextUsage } from "../../../protocol/context-usage.ts";
import type { JarvixBridge } from "../../../protocol/ipc.ts";
import type { PermissionRequest } from "../../../protocol/permission.ts";
import type { JarvixProject } from "../../../protocol/project.ts";
import type {
    JarvixGoal,
    JarvixSession,
    JarvixSessionSummary
} from "../../../protocol/session.ts";
import { ingestBackgroundTasks } from "../background-tasks/store.ts";
import { ingest } from "../components/transcript/state/transcript-store.ts";
import {
    isCurrentPermissionRequest,
    type ActivePermissionRequest
} from "../permission-request-state.ts";
import type { RequestEventGate } from "../request-event-gate.ts";
import { loadSessionSnapshot } from "./session-data.ts";

export type SessionEventsOptions = {
    bridge: JarvixBridge | undefined;
    activeSessionIdRef: RefObject<string | null>;
    permissionRequestRef: RefObject<ActivePermissionRequest | null>;
    requestEventGate: RequestEventGate;
    activateSession: (session: JarvixSession | null) => void;
    clearPermissionRequest: (sessionId?: string, requestId?: string) => void;
    updateSessionName: (sessionId: string, name: string) => void;
    updateGoalState: (goal: JarvixGoal | null) => void;
    setProjects: Dispatch<SetStateAction<JarvixProject[]>>;
    setSessions: Dispatch<SetStateAction<JarvixSessionSummary[]>>;
    setArchivedSessions: Dispatch<SetStateAction<JarvixSessionSummary[]>>;
    setContextUsage: Dispatch<SetStateAction<JarvixContextUsage | null>>;
    setProviderContextRevision: Dispatch<SetStateAction<number>>;
    setPermissionRequest: Dispatch<SetStateAction<PermissionRequest | null>>;
    setReady: Dispatch<SetStateAction<boolean>>;
};

export function useSessionEvents(options: SessionEventsOptions): void {
    const {
        bridge,
        activeSessionIdRef,
        permissionRequestRef,
        requestEventGate,
        activateSession,
        clearPermissionRequest,
        updateSessionName,
        updateGoalState,
        setProjects,
        setSessions,
        setArchivedSessions,
        setContextUsage,
        setProviderContextRevision,
        setPermissionRequest,
        setReady
    } = options;

    useEffect(() => {
        if (!bridge) {
            setReady(true);
            return;
        }

        let cancelled = false;
        const unsubscribe = bridge.onEvents((batch) => {
            let providerContextChanged = false;
            for (const event of batch.events) {
                if (
                    event.type === "context.usage" &&
                    batch.sessionId === activeSessionIdRef.current
                ) {
                    setContextUsage(event.usage);
                    providerContextChanged = true;
                }
                if (
                    event.type === "permission.request" &&
                    batch.sessionId === activeSessionIdRef.current
                ) {
                    permissionRequestRef.current = {
                        sessionId: batch.sessionId,
                        request: event.request
                    };
                    setPermissionRequest(event.request);
                } else if (event.type === "permission.resolved") {
                    const current = permissionRequestRef.current;
                    if (isCurrentPermissionRequest(
                        current,
                        batch.sessionId,
                        event.requestId
                    )) {
                        clearPermissionRequest(batch.sessionId, event.requestId);
                    }
                }
                if (
                    event.type === "goal.updated" &&
                    batch.sessionId === activeSessionIdRef.current
                ) {
                    updateGoalState(event.goal);
                }
            }
            if (providerContextChanged) {
                setProviderContextRevision((revision) => revision + 1);
            }
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
                const snapshot = await loadSessionSnapshot(bridge);
                if (cancelled) {
                    return;
                }
                setProjects(snapshot.projects);
                setSessions(snapshot.sessions);
                setArchivedSessions(snapshot.archivedSessions);
                const latest = snapshot.sessions[0];
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
    }, [
        activateSession,
        activeSessionIdRef,
        bridge,
        clearPermissionRequest,
        permissionRequestRef,
        requestEventGate,
        setArchivedSessions,
        setContextUsage,
        setPermissionRequest,
        setProjects,
        setProviderContextRevision,
        setReady,
        setSessions,
        updateGoalState,
        updateSessionName
    ]);
}
