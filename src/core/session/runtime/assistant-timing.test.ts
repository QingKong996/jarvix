import { expect, test } from "vitest";
import { AssistantTimingCollector } from "./assistant-timing.ts";

test("attributes stream time to waiting, thinking, and output spans", () => {
    let now = 0;
    const timing = new AssistantTimingCollector(1_000, () => now);

    now = 100;
    timing.observe({ type: "thinking.start", index: 0 });
    now = 250;
    timing.observe({ type: "thinking.delta", index: 0, delta: "plan" });
    now = 400;
    timing.observe({ type: "text.start", index: 1 });
    now = 900;
    timing.observe({ type: "toolCall.start", index: 2 });
    now = 1_000;

    expect(timing.finish()).toEqual({
        startedAt: 1_000,
        endedAt: 2_000,
        durationMs: 1_000,
        firstTokenAt: 1_100,
        spans: [
            { kind: "waiting", startedAt: 1_000, durationMs: 100 },
            { kind: "thinking", startedAt: 1_100, durationMs: 300 },
            { kind: "output", startedAt: 1_400, durationMs: 500 },
            { kind: "toolArgs", startedAt: 1_900, durationMs: 100 }
        ]
    });
});
