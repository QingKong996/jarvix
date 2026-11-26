import {
    useCallback,
    type Dispatch,
    type RefObject,
    type SetStateAction
} from "react";
import type { JarvixBridge } from "../../../protocol/ipc.ts";
import type { PermissionMode } from "../../../protocol/permission.ts";
import type {
    JarvixGoal,
    JarvixSession,
    JarvixSessionContext
} from "../../../protocol/session.ts";
import {
    beginTurn,
    discardInjectedPrompt,
    failRequest,
    finishRequest,
    injectUserPrompt,
    stopTurn
} from "../components/transcript/state/transcript-store.ts";
import type { RequestEventGate } from "../request-event-gate.ts";

export type PromptControllerOptions = {
    bridge: JarvixBridge | undefined;
    ready: boolean;
    busy: boolean;
    setBusy: Dispatch<SetStateAction<boolean>>;
    setRunning: Dispatch<SetStateAction<boolean>>;
    activeSessionIdRef: RefObject<string | null>;
    requestSessionIdRef: RefObject<string | null>;
    requestCompletionRef: RefObject<Promise<void> | null>;
    requestInFlightRef: RefObject<boolean>;
    sessionContextRef: RefObject<JarvixSessionContext>;
    sessionPermissionRef: RefObject<PermissionMode>;
    goalRef: RefObject<JarvixGoal | null>;
    setGoal: (goal: JarvixGoal | null) => void;
    hasUserMessagesRef: RefObject<boolean>;
    requestEventGate: RequestEventGate;
    activateSession: (session: JarvixSession | null) => void;
    clearPermissionRequest: (sessionId?: string, requestId?: string) => void;
    refreshSessions: () => Promise<void>;
};

export function usePromptController(options: PromptControllerOptions) {
    const {
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
        goalRef,
        setGoal,
        hasUserMessagesRef,
        requestEventGate,
        activateSession,
        clearPermissionRequest,
        refreshSessions
    } = options;

    const runPrompt = useCallback(async (
        question: string,
        initialSessionId: string | null,
        goalContent?: string,
        sandboxPaths: readonly string[] = []
    ): Promise<void> => {
        if (!bridge) {
            return;
        }
        setBusy(true);
        let sessionId = initialSessionId;

        try {
            const shouldAutoName = !hasUserMessagesRef.current;
            if (!sessionId) {
                const created = await bridge.createSession(
                    sessionContextRef.current,
                    sessionPermissionRef.current
                );
                activateSession(created);
                await refreshSessions();
                sessionId = created.meta.id;
            }
            if (goalContent !== undefined) {
                const goal = await bridge.setGoal(sessionId, goalContent);
                goalRef.current = goal;
                setGoal(goal);
            }
            requestSessionIdRef.current = sessionId;
            requestEventGate.resume(sessionId);
            setRunning(true);
            if (question.trim().length > 0) {
                beginTurn(question);
            }
            hasUserMessagesRef.current = true;
            const namingPrompt = question.trim() || goalContent;
            if (shouldAutoName && namingPrompt) {
                void bridge.autoNameSession(sessionId, namingPrompt).catch(() => undefined);
            }
            try {
                await bridge.request(question, sessionId, sandboxPaths);
            } catch (error) {
                failRequest(error instanceof Error ? error.message : String(error));
            }
        } catch (error) {
            failRequest(error instanceof Error ? error.message : String(error));
        } finally {
            finishRequest();
            requestSessionIdRef.current = null;
            setRunning(false);
            requestInFlightRef.current = false;
            setBusy(false);
            await refreshSessions();
        }
    }, [
        activateSession,
        bridge,
        goalRef,
        hasUserMessagesRef,
        refreshSessions,
        requestEventGate,
        requestSessionIdRef,
        sessionContextRef,
        sessionPermissionRef,
        setGoal,
        setBusy,
        setRunning
    ]);

    const startRequest = useCallback(async (
        question: string,
        sessionId: string | null,
        goalContent?: string,
        sandboxPaths: readonly string[] = []
    ): Promise<void> => {
        requestInFlightRef.current = true;
        const request = runPrompt(question, sessionId, goalContent, sandboxPaths);
        requestCompletionRef.current = request;
        try {
            await request;
        } finally {
            if (requestCompletionRef.current === request) {
                requestCompletionRef.current = null;
            }
        }
    }, [requestCompletionRef, requestInFlightRef, runPrompt]);

    const send = useCallback(async (
        question: string,
        sandboxPaths: readonly string[] = []
    ): Promise<void> => {
        const normalized = question.trim();
        if ((!normalized && !goalRef.current) || !bridge || !ready) {
            return;
        }
        const activeRequestSessionId = requestSessionIdRef.current;
        if (activeRequestSessionId) {
            if (!normalized) {
                return;
            }
            const promptId = injectUserPrompt(normalized);
            try {
                if (await bridge.injectPrompt(
                    normalized,
                    activeRequestSessionId,
                    promptId,
                    sandboxPaths
                )) {
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
            await startRequest(
                normalized,
                activeSessionIdRef.current,
                undefined,
                sandboxPaths
            );
            return;
        }
        if (busy || requestInFlightRef.current) {
            return;
        }
        await startRequest(
            normalized,
            activeSessionIdRef.current,
            undefined,
            sandboxPaths
        );
    }, [
        activeSessionIdRef,
        bridge,
        busy,
        goalRef,
        ready,
        requestCompletionRef,
        requestInFlightRef,
        requestSessionIdRef,
        startRequest
    ]);

    const submitGoal = useCallback(async (
        content: string,
        sandboxPaths: readonly string[] = []
    ): Promise<void> => {
        const normalized = content.trim();
        if (!normalized || !bridge || !ready || busy || requestInFlightRef.current) {
            return;
        }
        await startRequest(
            "",
            activeSessionIdRef.current,
            normalized,
            sandboxPaths
        );
    }, [
        activeSessionIdRef,
        bridge,
        busy,
        ready,
        requestInFlightRef,
        startRequest
    ]);

    const loadSkill = useCallback(async (name: string): Promise<void> => {
        if (!bridge || !ready) {
            throw new Error("Jarvix is not ready");
        }
        if (busy || requestInFlightRef.current) {
            throw new Error("Wait for the active request to finish");
        }
        setBusy(true);
        try {
            let sessionId = activeSessionIdRef.current;
            if (!sessionId) {
                const created = await bridge.createSession(
                    sessionContextRef.current,
                    sessionPermissionRef.current
                );
                activateSession(created);
                await refreshSessions();
                sessionId = created.meta.id;
            }
            await bridge.loadSkill(sessionId, name);
        } finally {
            setBusy(false);
        }
    }, [
        activateSession,
        activeSessionIdRef,
        bridge,
        busy,
        ready,
        refreshSessions,
        requestInFlightRef,
        sessionContextRef,
        sessionPermissionRef,
        setBusy
    ]);

    const stop = useCallback(async (): Promise<void> => {
        const sessionId = requestSessionIdRef.current;
        if (!bridge || !sessionId) {
            return;
        }
        stopTurn();
        clearPermissionRequest(sessionId);
        requestEventGate.pause(sessionId);
        setRunning(false);
        try {
            await bridge.stopRequest(sessionId);
        } catch {
            requestEventGate.cancelPause(sessionId);
            setRunning(true);
            return;
        }
    }, [
        bridge,
        clearPermissionRequest,
        requestEventGate,
        requestSessionIdRef,
        setRunning
    ]);

    const clearGoal = useCallback(async (): Promise<void> => {
        const sessionId = activeSessionIdRef.current;
        if (!bridge || !sessionId) {
            goalRef.current = null;
            setGoal(null);
            return;
        }
        if (requestSessionIdRef.current === sessionId) {
            stopTurn();
            clearPermissionRequest(sessionId);
            requestEventGate.pause(sessionId);
            setRunning(false);
            try {
                await bridge.stopRequest(sessionId);
            } catch {
                requestEventGate.cancelPause(sessionId);
            }
        }
        try {
            await bridge.clearGoal(sessionId);
        } catch {
            return;
        }
        goalRef.current = null;
        setGoal(null);
        await refreshSessions();
    }, [
        activeSessionIdRef,
        bridge,
        clearPermissionRequest,
        goalRef,
        refreshSessions,
        requestEventGate,
        requestSessionIdRef,
        setGoal,
        setRunning
    ]);

    return { send, stop, submitGoal, clearGoal, loadSkill };
}
