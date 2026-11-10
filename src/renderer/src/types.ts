export type CommittedBlock =
    | {
        type: "text";
        text: string;
    } | {
        type: "thinking";
        thinking: string;
    };

/** Immutable history entry. Only `done` commits an assistant turn here. */
export type CommittedTurn = {
    id: string;
    role: "user" | "assistant";
    text: string;
    blocks: CommittedBlock[];
    error: string | null;
    reason: string | null;
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
