import type {
    LlmContentBlock,
    LlmMessage,
    LlmSystemMessage,
    LlmToolResultMessage
} from "../../../../../protocol/llm.ts";
import {
    toolResultContentText,
    type LlmToolResultContent
} from "../../../../../protocol/llm.ts";
import type { ToolCallEndReason } from "../../../../../runtime/tools/types.ts";
import {
    createToolCallViewData,
    isToolCallViewData,
    type ToolCallViewData
} from "../../../../../runtime/tools/view.ts";
import type { CommittedBlock, CommittedTurn } from "./types.ts";

type HistoryToolCallLocation = {
    turnIndex: number;
    blockIndex: number;
};

/** Restore persisted messages as committed turns, in file order. */
export function hydrateSession(messages: LlmMessage[]): CommittedTurn[] {
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

export function toHistoryBlock(block: LlmContentBlock): CommittedBlock[] {
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

export function systemTurn(id: string, message: LlmSystemMessage): CommittedTurn {
    return {
        id,
        role: "system",
        text: message.content,
        blocks: [],
        error: null,
        reason: null
    };
}

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

function applyHistoryToolResult(
    turns: CommittedTurn[],
    toolCalls: ReadonlyMap<string, HistoryToolCallLocation>,
    toolCallId: string,
    content: LlmToolResultMessage["content"],
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
        ? withToolResultImages(details, content)
        : {
            ...block.data,
            output: toolResultContentText(content),
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

function withToolResultImages(
    data: ToolCallViewData,
    content: LlmToolResultMessage["content"]
): ToolCallViewData {
    if (
        data.kind !== "image.view_image" ||
        data.imageUrl.length > 0 ||
        typeof content === "string"
    ) {
        return data;
    }
    const image = content.find(
        (block): block is Extract<LlmToolResultContent, { type: "image" }> =>
            block.type === "image"
    );
    return image
        ? {
            ...data,
            mimeType: image.mimeType,
            imageUrl: `data:${image.mimeType};base64,${image.data}`
        }
        : data;
}

function historyToolEndReason(data: ToolCallViewData): ToolCallEndReason {
    return data.status === "running" || data.status === "timed_out"
        ? "terminated"
        : "exited";
}
