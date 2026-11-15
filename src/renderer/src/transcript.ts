import type {
    LlmAssistantMessage,
    LlmContentBlock,
    LlmMessage,
    LlmSystemMessage
} from "../../llm/types.ts";
import type { JarvixEvent } from "../../protocol/event.ts";
import {
    appendToolOutput,
    createToolCallViewData,
    isToolCallViewData,
    type ToolCallViewData
} from "../../tools/view.ts";
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
    const turns: CommittedTurn[] = [];
    for (const [index, message] of messages.entries()) {
        const id = `history-${index}`;
        if (message.role === "user") {
            turns.push({
                id,
                role: "user",
                text: message.content,
                blocks: [],
                error: null,
                reason: null
            });
            continue;
        }
        if (message.role === "assistant") {
            turns.push({
                id,
                role: "assistant",
                text: "",
                blocks: message.content.flatMap(toHistoryBlock),
                error: message.errorMessage ?? null,
                reason: message.stopReason
            });
            continue;
        }
        if (message.role === "system") {
            turns.push(systemTurn(id, message));
            continue;
        }
        applyHistoryToolResult(turns, message.toolCallId, message.content, message.details, message.isError);
    }
    return turns;
}

function toHistoryBlock(block: LlmContentBlock): CommittedBlock[] {
    switch (block.type) {
        case "text":
            return [{ type: "text", text: block.text }];
        case "thinking":
            return [{ type: "thinking", thinking: block.thinking }];
        case "toolCall":
            return [{
                type: "tool",
                toolCallId: block.id,
                toolName: block.name,
                data: createToolCallViewData(block.name, block.arguments),
                isError: false,
                endReason: null
            }];
    }
}

function applyHistoryToolResult(
    turns: CommittedTurn[],
    toolCallId: string,
    content: string,
    details: unknown,
    isError: boolean
): void {
    for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
        const turn = turns[turnIndex];
        if (!turn || turn.role !== "assistant") {
            continue;
        }
        const blockIndex = turn.blocks.findIndex(
            (block) => block.type === "tool" && block.toolCallId === toolCallId
        );
        if (blockIndex === -1) {
            continue;
        }
        const block = turn.blocks[blockIndex];
        if (!block || block.type !== "tool") {
            return;
        }
        const data: ToolCallViewData = isToolCallViewData(details)
            ? details
            : {
                ...block.data,
                output: content,
                status: isError ? "failed" : "completed"
            };
        const blocks = [...turn.blocks];
        blocks[blockIndex] = {
            ...block,
            data,
            isError,
            endReason: data.status === "timed_out" ? "background" : "exited"
        };
        turns[turnIndex] = { ...turn, blocks };
        return;
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
        case "log":
        case "session.renamed":
            return state;
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

function systemTurn(id: string, message: LlmSystemMessage): CommittedTurn {
    return {
        id,
        role: "system",
        text: message.content,
        blocks: [],
        error: null,
        reason: null
    };
}

function updateToolBlock(
    state: TranscriptState,
    toolCallId: string,
    update: (block: Extract<CommittedBlock, { type: "tool" }>) => Extract<CommittedBlock, { type: "tool" }>
): TranscriptState {
    let changed = false;
    const committed = state.committed.map((turn) => {
        let turnChanged = false;
        const blocks = turn.blocks.map((block) => {
            if (block.type !== "tool" || block.toolCallId !== toolCallId) {
                return block;
            }
            changed = true;
            turnChanged = true;
            return update(block);
        });
        return turnChanged ? { ...turn, blocks } : turn;
    });
    return changed ? { ...state, committed } : state;
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
