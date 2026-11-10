import type { AssistantBlock, JarvixEvent } from "../../protocol/event.ts";
import type { CommittedBlock, CommittedTurn, LiveBlock, TranscriptState } from "./types.ts";

export type TranscriptAction =
    | {
        type: "turn.send";
        userId: string;
        assistantId: string;
        text: string;
    } | {
        type: "events.batch";
        events: JarvixEvent[];
    } | {
        type: "request.error";
        error: string;
    };

export const initialTranscriptState: TranscriptState = {
    committed: [],
    live: null
};

/** Single write path for user actions and events relayed from main. */
export function transcriptReducer(state: TranscriptState, action: TranscriptAction): TranscriptState {
    switch (action.type) {
        case "turn.send":
            return {
                committed: [
                    ...state.committed,
                    {
                        id: action.userId,
                        role: "user",
                        text: action.text,
                        blocks: [],
                        error: null,
                        reason: null
                    }
                ],
                live: { id: action.assistantId, blocks: [] }
            };
        case "request.error":
            return commitLive(state, action.error);
        case "events.batch":
            return action.events.reduce(applyEvent, state);
    }
}

function applyEvent(state: TranscriptState, event: JarvixEvent): TranscriptState {
    switch (event.type) {
        case "text.start":
            return upsertLiveBlock(state, event.contentIndex, "text", "");
        case "text.delta":
            return upsertLiveBlock(state, event.contentIndex, "text", event.delta);
        case "thinking.start":
            return upsertLiveBlock(state, event.contentIndex, "thinking", "");
        case "thinking.delta":
            return upsertLiveBlock(state, event.contentIndex, "thinking", event.delta);
        case "done":
            return commitDone(state, event.blocks, event.reason);
        case "error":
            return commitLive(state, event.error ?? "Unknown error");
        case "text.end":
        case "thinking.end":
        case "start":
        case "log":
            return state;
    }
}

function upsertLiveBlock(
    state: TranscriptState,
    index: number,
    kind: LiveBlock["kind"],
    delta: string
): TranscriptState {
    const live = state.live;
    if (!live) {
        return state;
    }
    const position = live.blocks.findIndex((block) => block.index === index);
    const existing = position === -1 ? null : live.blocks[position] ?? null;
    const blocks = existing
        ? live.blocks.map((block, at) => at === position ? { index, kind, text: block.text + delta } : block)
        : [...live.blocks, { index, kind, text: delta }];
    blocks.sort((left, right) => left.index - right.index);
    return { ...state, live: { ...live, blocks } };
}

/** `done` is the only commit point: replace the live turn with authoritative blocks. */
function commitDone(state: TranscriptState, blocks: AssistantBlock[], reason: string): TranscriptState {
    const live = state.live;
    if (!live) {
        return state;
    }
    const sorted = [...blocks].sort((left, right) => left.index - right.index);
    return {
        committed: [...state.committed, {
            id: live.id,
            role: "assistant",
            text: "",
            blocks: sorted.map(toCommittedBlock),
            error: null,
            reason
        }],
        live: null
    };
}

function commitLive(state: TranscriptState, error: string): TranscriptState {
    const live = state.live;
    if (!live) {
        return state;
    }
    return {
        committed: [...state.committed, {
            id: live.id,
            role: "assistant",
            text: "",
            blocks: live.blocks.map((block) => block.kind === "text"
                ? { type: "text", text: block.text }
                : { type: "thinking", thinking: block.text }),
            error,
            reason: null
        }],
        live: null
    };
}

function toCommittedBlock(block: AssistantBlock): CommittedBlock {
    return block.type === "text"
        ? { type: "text", text: block.text }
        : { type: "thinking", thinking: block.thinking };
}
