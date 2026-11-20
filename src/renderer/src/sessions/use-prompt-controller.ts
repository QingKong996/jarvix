import {
    useCallback,
    type Dispatch,
    type RefObject,
    type SetStateAction
} from "react";
import type { JarvixBridge } from "../../../protocol/ipc.ts";
import type { PermissionMode } from "../../../protocol/permission.ts";
import type {
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
        hasUserMessagesRef,
        requestEventGate,
        activateSession,
        clearPermissionRequest,
        refreshSessions
    } = options;

    const runPrompt = useCallback(async (
        question: string,
        initialSessionId: string | null
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
            requestSessionIdRef.current = sessionId;
            requestEventGate.resume(sessionId);
            setRunning(true);
            beginTurn(question);
            hasUserMessagesRef.current = true;
            if (shouldAutoName) {
                void bridge.autoNameSession(sessionId, question).catch(() => undefined);
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
            requestInFlightRef.current = false;
            setBusy(false);
            await refreshSessions();
        }
    }, [
        activateSession,
        bridge,
        hasUserMessagesRef,
        refreshSessions,
        requestEventGate,
        requestSessionIdRef,
        sessionContextRef,
        sessionPermissionRef,
        setBusy,
        setRunning
    ]);

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
    }, [requestCompletionRef, requestInFlightRef, runPrompt]);

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
    }, [
        activeSessionIdRef,
        bridge,
        busy,
        ready,
        requestCompletionRef,
        requestInFlightRef,
        requestSessionIdRef,
        startRequest
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

    return { send, stop };
}
