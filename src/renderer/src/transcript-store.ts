import type { LlmMessage } from "../../llm/types.ts";
import type { JarvixEvent } from "../../protocol/event.ts";
import { initialTranscriptState, transcriptReducer, type TranscriptAction } from "./transcript.ts";
import type { CommittedTurn, LiveTurn, TranscriptState } from "./types.ts";

let state: TranscriptState = initialTranscriptState;
let sequence = 0;

const committedListeners = new Set<() => void>();
const liveListeners = new Set<() => void>();

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
    state = next;
    if (committedChanged) {
        notify(committedListeners);
    }
    if (liveChanged) {
        notify(liveListeners);
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

export function getCommitted(): CommittedTurn[] {
    return state.committed;
}

export function getLive(): LiveTurn | null {
    return state.live;
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

export function failRequest(error: string): void {
    apply({ type: "request.error", error });
}
