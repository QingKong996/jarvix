import { expect, test } from "vitest";
import { visibleTranscriptWindow } from "./history-window.ts";
import type { CommittedTurn } from "./types.ts";

function turns(count: number): CommittedTurn[] {
    return Array.from({ length: count }, (_, index): CommittedTurn => ({
        id: `turn-${index}`,
        role: index % 2 === 0 ? "user" : "assistant",
        text: `turn ${index}`,
        blocks: [],
        error: null,
        reason: null
    }));
}

test("initially keeps only the newest transcript page", () => {
    const window = visibleTranscriptWindow(turns(500), null);

    expect(window.start).toBe(420);
    expect(window.omitted).toBe(420);
    expect(window.turns).toHaveLength(80);
    expect(window.turns[0]?.id).toBe("turn-420");
});

test("keeps an explicitly revealed older transcript page anchored", () => {
    const window = visibleTranscriptWindow(turns(500), "turn-350");

    expect(window.start).toBe(350);
    expect(window.omitted).toBe(350);
    expect(window.turns[0]?.id).toBe("turn-350");
});

test("moves a page boundary backward so an assistant reply keeps its prompt", () => {
    const history = turns(100);
    const window = visibleTranscriptWindow(history, history[91]!.id, 11);

    expect(window.start).toBe(88);
    expect(window.turns[0]?.role).toBe("user");
});

test("renders all turns when the history is smaller than one page", () => {
    const window = visibleTranscriptWindow(turns(12), null, 80);

    expect(window.start).toBe(0);
    expect(window.omitted).toBe(0);
    expect(window.turns).toHaveLength(12);
});

test("does not expand a tool-heavy page to the only old user prompt", () => {
    const history = turns(500).map((turn, index): CommittedTurn => ({
        ...turn,
        role: index === 0 ? "user" : "assistant"
    }));

    const window = visibleTranscriptWindow(history, null);

    expect(window.start).toBe(420);
    expect(window.omitted).toBe(420);
    expect(window.turns).toHaveLength(80);
});
