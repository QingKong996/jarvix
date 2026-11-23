import { expect, test } from "vitest";
import type { LlmMessage } from "../../../protocol/llm.ts";
import {
    compactBlockContent,
    contextCompactionReserveTokens,
    contextCompactionTriggerTokens,
    selectCompactionRange
} from "./context-compaction.ts";

test("derives the default reserve from the smaller of ten percent and 64K", () => {
    expect(contextCompactionReserveTokens(1_000_000)).toBe(64_000);
    expect(contextCompactionReserveTokens(128_000)).toBe(12_800);
    expect(contextCompactionReserveTokens(64_000)).toBe(6_400);
    expect(contextCompactionReserveTokens(128_000, 20_000)).toBe(20_000);
    expect(contextCompactionTriggerTokens(128_000)).toBe(115_200);
});

test("expands the selected range by doubling while preserving older and recent messages", () => {
    const history = Array.from({ length: 8 }, (_, index): LlmMessage => ({
        role: "user",
        content: `m${index}-${"x".repeat(3_497)}`,
        timestamp: index
    }));

    const selection = selectCompactionRange(history, 5_000, 3_000, {
        retainedTokens: 3_000,
        compactBlockTokens: 100
    });

    expect(selection).toEqual({
        start: 1,
        end: 5,
        selectedTokens: 4_000,
        projectedTokens: 1_100
    });
    expect(history[0]).toMatchObject({ content: expect.stringContaining("m0-") });
    expect(history[5]).toMatchObject({ content: expect.stringContaining("m5-") });
});

test("does not compact when every message fits in the retention window", () => {
    const history: LlmMessage[] = Array.from({ length: 3 }, (_, index) => ({
        role: "user",
        content: "small",
        timestamp: index
    }));

    expect(selectCompactionRange(history, 10_000, 1_000, {
        retainedTokens: 20_000
    })).toBeNull();
});

test("never selects the leading environment context", () => {
    const history: LlmMessage[] = [{
        role: "system",
        content: "<environment_context>\n- permission: read-only\n</environment_context>",
        context: "environment",
        environmentKey: "[\"read-only\",[]]",
        timestamp: 0
    }, ...Array.from({ length: 5 }, (_, index): LlmMessage => ({
        role: "user",
        content: "x".repeat(3_500),
        timestamp: index + 1
    }))];

    const selection = selectCompactionRange(history, 6_000, 3_000, {
        retainedTokens: 2_000,
        compactBlockTokens: 100
    });

    expect(selection).toMatchObject({
        start: 1,
        end: 4
    });
});

test("aligns the retained range to a complete user turn", () => {
    const history: LlmMessage[] = [
        userTurn(1),
        assistantTurn(2),
        userTurn(3),
        assistantTurn(4),
        {
            role: "toolResult",
            toolCallId: "call-1",
            toolName: "read_file",
            content: "x".repeat(3_500),
            isError: false,
            timestamp: 5
        },
        assistantTurn(6),
        userTurn(7),
        assistantTurn(8)
    ];

    const selection = selectCompactionRange(history, 5_000, 3_500, {
        retainedTokens: 3_500,
        compactBlockTokens: 100
    });

    expect(selection).toMatchObject({
        start: 0,
        end: 2
    });
    expect(history[selection!.end]).toMatchObject({
        role: "user",
        timestamp: 3
    });
});

test("does not re-compact an existing compact block on its own", () => {
    const history: LlmMessage[] = [
        {
            role: "user",
            content: compactBlockContent("s".repeat(3_500)),
            context: "compact",
            timestamp: 0
        },
        ...Array.from({ length: 3 }, (_, index): LlmMessage => ({
            role: "user",
            content: "x".repeat(3_500),
            timestamp: index + 1
        }))
    ];

    expect(selectCompactionRange(history, 5_000, 3_000, {
        retainedTokens: 3_000,
        compactBlockTokens: 2_048
    })).toBeNull();
});

test("normalizes compaction blocks to one compact tag pair", () => {
    expect(compactBlockContent("<compact>\nSummary\n</compact>"))
        .toBe("<compact>\nSummary\n</compact>");
    expect(compactBlockContent("Summary")).toBe("<compact>\nSummary\n</compact>");
});

function userTurn(timestamp: number): LlmMessage {
    return {
        role: "user",
        content: "x".repeat(3_500),
        timestamp
    };
}

function assistantTurn(timestamp: number): LlmMessage {
    return {
        role: "assistant",
        content: [{ type: "text", text: "x".repeat(3_500) }],
        provider: "test",
        model: "test",
        api: "test",
        usage: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 0,
            cost: 0
        },
        stopReason: "stop",
        timestamp
    };
}
