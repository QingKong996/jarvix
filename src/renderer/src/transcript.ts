import type { LlmAssistantMessage, LlmContentBlock, LlmMessage } from "../../llm/types.ts";
import type { JarvixEvent } from "../../protocol/event.ts";
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
    } | {
        type: "session.loaded";
        messages: LlmMessage[];
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
        case "session.loaded":
            return { committed: hydrateSession(action.messages), live: null };
    }
}

/** Restore persisted messages as committed turns, in file order. */
function hydrateSession(messages: LlmMessage[]): CommittedTurn[] {
    return messages.map((message, index): CommittedTurn => {
        const id = `history-${index}`;
        if (message.role === "user") {
            return {
                id,
                role: "user",
                text: message.content,
                blocks: [],
                error: null,
                reason: null
            };
        }
        return {
            id,
            role: "assistant",
            text: "",
            blocks: message.content.flatMap(toHistoryBlock),
            error: message.errorMessage ?? null,
            reason: message.stopReason
        };
    });
}

function toHistoryBlock(block: LlmContentBlock): CommittedBlock[] {
    switch (block.type) {
        case "text":
            return [{ type: "text", text: block.text }];
        case "thinking":
            return [{ type: "thinking", thinking: block.thinking }];
        case "toolCall":
            return [];
    }
}

function applyEvent(state: TranscriptState, event: JarvixEvent): TranscriptState {
    switch (event.type) {
        case "text.start":
            return upsertLiveBlock(state, event.index, "text", "");
        case "text.delta":
            return upsertLiveBlock(state, event.index, "text", event.delta);
        case "thinking.start":
            return upsertLiveBlock(state, event.index, "thinking", "");
        case "thinking.delta":
            return upsertLiveBlock(state, event.index, "thinking", event.delta);
        case "done":
        case "error":
            return commitMessage(state, event.message);
        case "request.error":
            return commitLive(state, event.error);
        case "start":
            return state.live ? state : {
                ...state,
                live: { id: `stream-${state.committed.length}`, blocks: [] }
            };
        case "text.end":
        case "thinking.end":
        case "toolCall.start":
        case "toolCall.delta":
        case "toolCall.end":
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

function commitMessage(state: TranscriptState, message: LlmAssistantMessage): TranscriptState {
    const live = state.live;
    if (!live) {
        return state;
    }
    return {
        committed: [...state.committed, {
            id: live.id,
            role: "assistant",
            text: "",
            blocks: message.content.flatMap(toHistoryBlock),
            error: message.errorMessage ?? null,
            reason: message.stopReason
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
