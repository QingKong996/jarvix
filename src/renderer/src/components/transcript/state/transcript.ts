import type {
    LlmAssistantMessage,
    LlmMessage,
    LlmSystemMessage
} from "../../../../../llm/types.ts";
import type { JarvixEvent } from "../../../../../protocol/event.ts";
import { appendToolOutput } from "../../../../../core/tools/view.ts";
import { hydrateSession, systemTurn, toHistoryBlock } from "./history.ts";
import { updateToolBlock } from "./tool-blocks.ts";
import type {
    LiveBlock,
    TranscriptState
} from "./types.ts";

export type TranscriptAction =
    | {
        type: "turn.send";
        userId: string;
        assistantId: string;
        text: string;
    } | {
        type: "turn.inject";
        userId: string;
        text: string;
    } | {
        type: "turn.discard";
        userId: string;
    } | {
        type: "turn.finish";
    } | {
        type: "events.batch";
        events: JarvixEvent[];
    } | {
        type: "turn.stop";
    } | {
        type: "request.error";
        error: string;
    } | {
        type: "session.loaded";
        messages: LlmMessage[];
    };

export const initialTranscriptState: TranscriptState = {
    committed: [],
    live: null,
    injected: []
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
                live: { id: action.assistantId, blocks: [] },
                injected: []
            };
        case "turn.inject":
            return {
                ...state,
                injected: [...state.injected, {
                    id: action.userId,
                    role: "user",
                    text: action.text,
                    blocks: [],
                    error: null,
                    reason: null
                }]
            };
        case "turn.discard":
            return {
                ...state,
                injected: state.injected.filter((turn) => turn.id !== action.userId)
            };
        case "turn.finish":
            return state.injected.length === 0
                ? state
                : { ...state, injected: [] };
        case "turn.stop":
            return stopLive(state);
        case "request.error":
            return commitLive(state, action.error);
        case "events.batch":
            return action.events.reduce(applyEvent, state);
        case "session.loaded":
            return {
                committed: hydrateSession(action.messages),
                live: null,
                injected: []
            };
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
        case "backgroundTask.start":
        case "backgroundTask.output":
        case "backgroundTask.end":
        case "backgroundTask.consume":
        case "backgroundTask.discard":
        case "log":
        case "session.renamed":
        case "context.usage":
        case "permission.request":
        case "permission.resolved":
            return state;
        case "prompt.injected":
            return commitInjectedPrompt(state, event.promptId, event.text);
        case "tool.start":
            return updateToolBlock(state, event.toolCallId, (block) => ({
                ...block,
                data: event.data,
                isError: false,
                endReason: null
            }));
        case "tool.output":
            return updateToolBlock(state, event.toolCallId, (block) => block.endReason
                ? block
                : {
                    ...block,
                    data: appendToolOutput(block.data, event.data)
                });
        case "tool.end":
            return updateToolBlock(state, event.toolCallId, (block) => ({
                ...block,
                data: event.data,
                isError: event.isError,
                endReason: event.endReason
            }));
        case "system.message":
            return appendSystemMessage(state, event.message);
    }
}

function appendSystemMessage(state: TranscriptState, message: LlmSystemMessage): TranscriptState {
    const id = `system-${message.timestamp}-${state.committed.length}`;
    return {
        ...state,
        committed: [...state.committed, systemTurn(id, message)]
    };
}

function commitInjectedPrompt(
    state: TranscriptState,
    promptId: string,
    text: string
): TranscriptState {
    if (state.committed.some((turn) => turn.id === promptId)) {
        return state.injected.some((turn) => turn.id === promptId)
            ? { ...state, injected: state.injected.filter((turn) => turn.id !== promptId) }
            : state;
    }
    return {
        ...state,
        committed: [...state.committed, {
            id: promptId,
            role: "user",
            text,
            blocks: [],
            error: null,
            reason: null
        }],
        injected: state.injected.filter((turn) => turn.id !== promptId)
    };
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

function commitMessage(
    state: TranscriptState,
    message: LlmAssistantMessage
): TranscriptState {
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
        live: null,
        injected: state.injected
    };
}

function commitLive(state: TranscriptState, error: string): TranscriptState {
    const live = state.live;
    if (!live) {
        const last = state.committed.at(-1);
        if (last?.role === "assistant" && last.error === error) {
            return state.injected.length === 0 ? state : { ...state, injected: [] };
        }
        return {
            committed: [...state.committed, {
                id: `request-error-${state.committed.length}`,
                role: "assistant",
                text: "",
                blocks: [],
                error,
                reason: null
            }],
            live: null,
            injected: []
        };
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
        live: null,
        injected: []
    };
}

function stopLive(state: TranscriptState): TranscriptState {
    const live = state.live;
    if (!live) {
        return state.injected.length === 0 ? state : { ...state, injected: [] };
    }
    if (live.blocks.length === 0) {
        return { ...state, live: null, injected: [] };
    }
    return {
        committed: [...state.committed, {
            id: live.id,
            role: "assistant",
            text: "",
            blocks: live.blocks.map((block) => block.kind === "text"
                ? { type: "text", text: block.text }
                : { type: "thinking", thinking: block.text }),
            error: null,
            reason: "aborted"
        }],
        live: null,
        injected: []
    };
}
