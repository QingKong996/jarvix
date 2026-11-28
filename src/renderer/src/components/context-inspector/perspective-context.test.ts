import { expect, test } from "vitest";
import {
    contextTrendFor,
    perspectiveContextParts
} from "./perspective-context.ts";

test("orders stored context samples and appends the current usage", () => {
    expect(contextTrendFor([
        { step: 2, atMs: 3_000, estimatedTokens: 2_400 },
        { step: 1, atMs: 1_000, estimatedTokens: 1_200 }
    ], {
        estimatedTokens: 3_600,
        contextWindow: 10_000
    }, 4_000)).toEqual([
        { step: 1, atMs: 1_000, estimatedTokens: 1_200 },
        { step: 2, atMs: 3_000, estimatedTokens: 2_400 },
        {
            step: 3,
            atMs: 4_000,
            estimatedTokens: 3_600,
            current: true
        }
    ]);
});

test("anchors context categories to the current occupied tokens", () => {
    const parts = perspectiveContextParts({
        systemPrompt: 40,
        tools: 30,
        user: 20,
        injected: 10,
        skills: 0,
        assistant: 0,
        tool: 0
    }, 100);

    expect(parts).toEqual([
        { kind: "systemPrompt", tokens: 40, share: 0.4 },
        { kind: "tools", tokens: 30, share: 0.3 },
        { kind: "user", tokens: 20, share: 0.2 },
        { kind: "injected", tokens: 10, share: 0.1 },
        { kind: "skills", tokens: 0, share: 0 },
        { kind: "assistant", tokens: 0, share: 0 },
        { kind: "tool", tokens: 0, share: 0 }
    ]);
});

test("rounds scaled categories without losing the anchored total", () => {
    const parts = perspectiveContextParts({
        systemPrompt: 1,
        tools: 1,
        user: 1,
        injected: 0,
        skills: 0,
        assistant: 0,
        tool: 0
    }, 100);

    expect(parts.reduce((sum, part) => sum + part.tokens, 0)).toBe(100);
    expect(parts.reduce((sum, part) => sum + part.share, 0)).toBe(1);
});
