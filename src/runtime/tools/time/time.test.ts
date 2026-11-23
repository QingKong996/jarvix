import { expect, test, vi } from "vitest";
import type { LlmToolCallBlock } from "../../../protocol/llm.ts";
import { createDefaultTools } from "../index.ts";
import {
    LOCAL_TIME_TOOL,
    LocalTimeTool,
    SLEEP_TOOL,
    SleepTool
} from "./time.ts";

const observer = { onOutput: () => undefined };

test("returns the current local time and registers both time tools", async () => {
    const tools = createDefaultTools();
    try {
        expect(tools.handles(LOCAL_TIME_TOOL)).toBe(true);
        expect(tools.handles(SLEEP_TOOL)).toBe(true);
    } finally {
        tools.dispose();
    }

    const before = Date.now();
    const result = await new LocalTimeTool().execute(call(LOCAL_TIME_TOOL, {}), observer);
    const after = Date.now();
    const value = JSON.parse(result.content) as {
        localTime: string;
        timeZone: string;
        utcOffset: string;
        epochMillis: number;
    };

    expect(result.isError).toBe(false);
    expect(result.data).toMatchObject({
        kind: "time.local_time",
        localTime: value.localTime,
        timeZone: value.timeZone,
        utcOffset: value.utcOffset,
        epochMillis: value.epochMillis,
        output: result.content,
        status: "completed"
    });
    expect(value.epochMillis).toBeGreaterThanOrEqual(before);
    expect(value.epochMillis).toBeLessThanOrEqual(after);
    expect(value.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(value.localTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
    expect(value.localTime.endsWith(value.utcOffset)).toBe(true);
});

test("sleep waits for the requested duration", async () => {
    vi.useFakeTimers();
    try {
        const tool = new SleepTool();
        let settled = false;
        const pending = tool.execute(call(SLEEP_TOOL, { durationMs: 100 }), observer)
            .then((result) => {
                settled = true;
                return result;
            });

        await vi.advanceTimersByTimeAsync(99);
        expect(settled).toBe(false);

        await vi.advanceTimersByTimeAsync(1);
        const result = await pending;

        expect(settled).toBe(true);
        expect(result.isError).toBe(false);
        expect(result.endReason).toBe("exited");
        expect(result.content).toBe("Slept for 100 ms.");
        expect(result.data).toMatchObject({
            kind: "time.sleep",
            durationMs: 100,
            elapsedMs: 100,
            status: "completed"
        });
    } finally {
        vi.useRealTimers();
    }
});

test("sleep stops when the request is aborted", async () => {
    vi.useFakeTimers();
    try {
        const controller = new AbortController();
        const pending = new SleepTool().execute(
            call(SLEEP_TOOL, { durationMs: 10_000 }),
            observer,
            controller.signal
        );

        await vi.advanceTimersByTimeAsync(25);
        controller.abort();
        const result = await pending;

        expect(result.isError).toBe(true);
        expect(result.content).toBe("Sleep interrupted after 25 ms.");
        expect(result.data).toMatchObject({
            kind: "time.sleep",
            durationMs: 10_000,
            elapsedMs: 25,
            status: "failed"
        });
    } finally {
        vi.useRealTimers();
    }
});

function call(name: string, arguments_: Record<string, unknown>): LlmToolCallBlock {
    return { type: "toolCall", id: "call-time", name, arguments: arguments_ };
}
