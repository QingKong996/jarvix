import { expect, test } from "vitest";
import type { LlmMessage } from "../../../protocol/llm.ts";
import {
    ContextSnapshotTracker,
    injectContext
} from "./context-injection.ts";

test("appends context to the tail by default", () => {
    const messages: LlmMessage[] = [userMessage("first")];

    injectContext(messages, { content: "second" });

    expect(messages.map(content)).toEqual(["first", "second"]);
    expect(messages[1]).toMatchObject({
        role: "system",
        context: "injected",
        content: "second"
    });
});

test("includes the declaration and content when provided", () => {
    const messages: LlmMessage[] = [];

    injectContext(messages, {
        declaration: "The environment changed.",
        content: "<environment_context />"
    });

    expect(messages[0]).toMatchObject({
        role: "system",
        context: "injected",
        content: "The environment changed.\n\n<environment_context />"
    });
});

test("requires a declaration for non-tail injections", () => {
    const messages: LlmMessage[] = [userMessage("first"), userMessage("second")];

    expect(() => injectContext(messages, {
        declaration: " ",
        content: "head",
        placement: { at: "start" }
    })).toThrow("requires a declaration");

    injectContext(messages, {
        declaration: "Session prefix.",
        content: "head",
        placement: { at: "start" }
    });
    injectContext(messages, {
        declaration: "Keep replies adjacent.",
        content: "middle",
        placement: { at: "before", index: 2 }
    });

    expect(messages.map(content)).toEqual([
        expect.stringContaining("Session prefix."),
        "first",
        expect.stringContaining("Keep replies adjacent."),
        "second"
    ]);
});

test("injects only snapshots that changed", () => {
    const tracker = new ContextSnapshotTracker();
    const initial = tracker.initialize([{
        key: "skills",
        fingerprint: "first",
        initial: {
            declaration: "Skills loaded.",
            content: "skill-a"
        },
        change: () => ({
            declaration: "Skills changed.",
            content: "skill-b"
        })
    }]);

    expect(initial).toEqual([{
        declaration: "Skills loaded.",
        content: "skill-a",
        contextKey: "skills",
        contextFingerprint: "first"
    }]);
    expect(tracker.refresh([{
        key: "skills",
        fingerprint: "first",
        change: () => ({ content: "unexpected" })
    }])).toEqual([]);
    expect(tracker.refresh([{
        key: "skills",
        fingerprint: "second",
        change: () => ({
            declaration: "Skills changed.",
            content: "skill-b"
        })
    }])).toEqual([{
        declaration: "Skills changed.",
        content: "skill-b",
        contextKey: "skills",
        contextFingerprint: "second"
    }]);
});

test("returns multiple atomic changes as separate injections", () => {
    const tracker = new ContextSnapshotTracker();
    tracker.initialize([{
        key: "skills",
        fingerprint: "first"
    }]);

    const changes = tracker.refresh([{
        key: "skills",
        fingerprint: "second",
        change: () => [
            { content: "added skill" },
            { content: "removed skill" }
        ]
    }]);

    expect(changes.map((injection) => injection.content)).toEqual([
        "added skill",
        "removed skill"
    ]);
});

test("keeps the context marker internal", () => {
    const messages: LlmMessage[] = [];
    const message = injectContext(messages, {
        declaration: "Context changed.",
        content: "<environment_context />"
    });

    expect(message).toMatchObject({ context: "injected" });
    expect(message.content).not.toContain("<context_injection>");
});

function userMessage(content: string): LlmMessage {
    return { role: "user", content, timestamp: 1 };
}

function content(message: LlmMessage): string {
    return message.role === "user" || message.role === "system"
        ? message.content
        : "";
}
