import type { LlmSystemNotice } from "../../llm/types.ts";
import type { ToolCallViewData } from "../../tools/view.ts";

export type CommittedBlock =
    | {
        type: "text";
        text: string;
    } | {
        type: "thinking";
        thinking: string;
    } | {
        type: "tool";
        toolCallId: string;
        toolName: string;
        data: ToolCallViewData;
        isError: boolean;
    };

/** Immutable history entry. Only `done` commits an assistant turn here. */
export type CommittedTurn = {
    id: string;
    role: "user" | "assistant" | "system";
    text: string;
    blocks: CommittedBlock[];
    error: string | null;
    reason: string | null;
    notice?: LlmSystemNotice | null;
};

/** Streaming state for the single in-flight assistant turn. */
export type LiveBlock = {
    index: number;
    kind: "text" | "thinking";
    text: string;
};

export type LiveTurn = {
    id: string;
    blocks: LiveBlock[];
};

export type TranscriptState = {
    committed: CommittedTurn[];
    live: LiveTurn | null;
};
