import type { CommittedTurn } from "./types.ts";

export const TRANSCRIPT_TURN_PAGE_SIZE = 80;
const MAX_PROMPT_LOOKBACK_TURNS = 32;

export type TranscriptWindow = {
    turns: CommittedTurn[];
    start: number;
    omitted: number;
    anchorId: string | null;
};

/** Keep the initial DOM bounded and align a partial page to a user prompt. */
export function visibleTranscriptWindow(
    turns: readonly CommittedTurn[],
    anchorId: string | null,
    pageSize = TRANSCRIPT_TURN_PAGE_SIZE
): TranscriptWindow {
    if (turns.length === 0) {
        return { turns: [], start: 0, omitted: 0, anchorId: null };
    }

    const latestStart = Math.max(0, turns.length - Math.max(1, pageSize));
    const anchored = anchorId
        ? turns.findIndex((turn) => turn.id === anchorId)
        : -1;
    const requestedStart = anchored >= 0
        ? Math.min(anchored, latestStart)
        : latestStart;
    const start = promptBoundary(
        turns,
        requestedStart,
        Math.min(Math.max(1, pageSize), MAX_PROMPT_LOOKBACK_TURNS)
    );
    return {
        turns: turns.slice(start),
        start,
        omitted: start,
        anchorId: start > 0 ? turns[start]!.id : null
    };
}

function promptBoundary(
    turns: readonly CommittedTurn[],
    start: number,
    maxLookback: number
): number {
    const lowerBound = Math.max(0, start - maxLookback);
    for (let index = start; index >= lowerBound; index -= 1) {
        if (turns[index]?.role === "user") {
            return index;
        }
    }
    return start;
}
