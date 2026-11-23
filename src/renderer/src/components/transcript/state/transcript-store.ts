import type { LlmMessage } from "../../../../../protocol/llm.ts";
import type { JarvixEvent } from "../../../../../protocol/event.ts";
import { initialTranscriptState, transcriptReducer, type TranscriptAction } from "./transcript.ts";
import type { CommittedTurn, LiveTurn, TranscriptState } from "./types.ts";

let state: TranscriptState = initialTranscriptState;
let sequence = 0;

const committedListeners = new Set<() => void>();
const liveListeners = new Set<() => void>();
const injectedListeners = new Set<() => void>();

function notify(listeners: Set<() => void>): void {
    for (const listener of listeners) {
        listener();
    }
}

function apply(action: TranscriptAction): void {
    const next = transcriptReducer(state, action);
    if (next === state) {
        return;
    }
    const committedChanged = next.committed !== state.committed;
    const liveChanged = next.live !== state.live;
    const injectedChanged = next.injected !== state.injected;
    state = next;
    if (committedChanged) {
        notify(committedListeners);
    }
    if (liveChanged) {
        notify(liveListeners);
    }
    if (injectedChanged) {
        notify(injectedListeners);
    }
}

export function subscribeCommitted(listener: () => void): () => void {
    committedListeners.add(listener);
    return () => {
        committedListeners.delete(listener);
    };
}

export function subscribeLive(listener: () => void): () => void {
    liveListeners.add(listener);
    return () => {
        liveListeners.delete(listener);
    };
}

export function subscribeInjected(listener: () => void): () => void {
    injectedListeners.add(listener);
    return () => {
        injectedListeners.delete(listener);
    };
}

export function getCommitted(): CommittedTurn[] {
    return state.committed;
}

export function getLive(): LiveTurn | null {
    return state.live;
}

export function getInjected(): CommittedTurn[] {
    return state.injected;
}

/** Single entry for every batch relayed from the main process. */
export function ingest(events: JarvixEvent[]): void {
    apply({ type: "events.batch", events });
}

/** Replace the transcript with the conversation restored at startup. */
export function hydrate(messages: LlmMessage[]): void {
    apply({ type: "session.loaded", messages });
}

export function beginTurn(text: string): void {
    sequence += 1;
    apply({
        type: "turn.send",
        userId: `user-${sequence}`,
        assistantId: `assistant-${sequence}`,
        text
    });
}

export function injectUserPrompt(text: string): string {
    sequence += 1;
    const userId = `user-${sequence}`;
    apply({ type: "turn.inject", userId, text });
    return userId;
}

export function discardInjectedPrompt(userId: string): void {
    apply({ type: "turn.discard", userId });
}

export function finishRequest(): void {
    apply({ type: "turn.finish" });
}

export function failRequest(error: string): void {
    apply({ type: "request.error", error });
}

export function stopTurn(): void {
    apply({ type: "turn.stop" });
}
