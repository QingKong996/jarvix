import type { CommittedTurn } from "./types.ts";

export const TRANSCRIPT_TURN_PAGE_SIZE = 80;

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
    const start = promptBoundary(turns, requestedStart);
    return {
        turns: turns.slice(start),
        start,
        omitted: start,
        anchorId: start > 0 ? turns[start]!.id : null
    };
}

function promptBoundary(turns: readonly CommittedTurn[], start: number): number {
    for (let index = start; index >= 0; index -= 1) {
        if (turns[index]?.role === "user") {
            return index;
        }
    }
    return start;
}
