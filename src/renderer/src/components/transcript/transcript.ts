import type {
    LlmAssistantMessage,
    LlmContentBlock,
    LlmMessage,
    LlmSystemMessage
} from "../../../../llm/types.ts";
import type { JarvixEvent } from "../../../../protocol/event.ts";
import type { ToolCallEndReason } from "../../../../core/tools/types.ts";
import {
    appendToolOutput,
    createToolCallViewData,
    isToolCallViewData,
    type ToolCallViewData
} from "../../../../core/tools/view.ts";
import type { CommittedBlock, CommittedTurn, LiveBlock, TranscriptState } from "./types.ts";

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
            return { committed: hydrateSession(action.messages), live: null, injected: [] };
    }
}

/** Restore persisted messages as committed turns, in file order. */
function hydrateSession(messages: LlmMessage[]): CommittedTurn[] {
    const turns: CommittedTurn[] = [];
    const toolCalls = new Map<string, HistoryToolCallLocation>();
    for (const [index, message] of messages.entries()) {
        const id = `history-${index}`;
        if (message.role === "system" && message.context === "environment") {
            continue;
        }
        if (message.role === "user") {
            if (message.context === "system-reminder") {
                turns.push({
                    id,
                    role: "system",
                    text: systemReminderText(message.content),
                    blocks: [],
                    error: null,
                    reason: null
                });
                continue;
            }
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
            const turnIndex = turns.length;
            const blocks = message.content.flatMap(toHistoryBlock);
            turns.push({
                id,
                role: "assistant",
                text: "",
                blocks,
                error: message.errorMessage ?? null,
                reason: message.stopReason
            });
            indexHistoryToolCalls(toolCalls, turnIndex, blocks);
            continue;
        }
        if (message.role === "system") {
            turns.push(systemTurn(id, message));
            continue;
        }
        applyHistoryToolResult(turns, toolCalls, message.toolCallId, message.content, message.details, message.isError);
    }
    return turns;
}

type HistoryToolCallLocation = {
    turnIndex: number;
    blockIndex: number;
};

function indexHistoryToolCalls(
    locations: Map<string, HistoryToolCallLocation>,
    turnIndex: number,
    blocks: CommittedBlock[]
): void {
    const seen = new Set<string>();
    for (const [blockIndex, block] of blocks.entries()) {
        if (block.type !== "tool" || seen.has(block.toolCallId)) {
            continue;
        }
        seen.add(block.toolCallId);
        locations.set(block.toolCallId, { turnIndex, blockIndex });
    }
}

function systemReminderText(content: string): string {
    const match = /^<system-reminder>\n?([\s\S]*?)\n?<\/system-reminder>$/.exec(content);
    return match?.[1] ?? content;
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
    toolCalls: ReadonlyMap<string, HistoryToolCallLocation>,
    toolCallId: string,
    content: string,
    details: unknown,
    isError: boolean
): void {
    const location = toolCalls.get(toolCallId);
    if (!location) {
        return;
    }
    const turn = turns[location.turnIndex];
    const block = turn?.blocks[location.blockIndex];
    if (!turn || block?.type !== "tool") {
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
    blocks[location.blockIndex] = {
        ...block,
        data,
        isError,
        endReason: historyToolEndReason(data)
    };
    turns[location.turnIndex] = { ...turn, blocks };
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

function historyToolEndReason(data: ToolCallViewData): ToolCallEndReason {
    return data.status === "running" || data.status === "timed_out"
        ? "terminated"
        : "exited";
}

function commitInjectedPrompt(state: TranscriptState, promptId: string, text: string): TranscriptState {
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
