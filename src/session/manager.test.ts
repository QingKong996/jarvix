import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test, vi } from "vitest";
import type { LlmUserMessage } from "../llm/types.ts";
import { SessionManager } from "./manager.ts";

const home = vi.hoisted(() => ({ path: "" }));

vi.mock("node:os", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:os")>();
    return { ...actual, homedir: () => home.path };
});

const base = mkdtempSync(join(tmpdir(), "jarvix-session-manager-"));

afterAll(() => {
    rmSync(base, { recursive: true, force: true });
});

test("creates and tracks independent sessions", () => {
    home.path = join(base, "create-home");
    const manager = new SessionManager();

    const first = manager.create();
    const second = manager.create();

    expect(first.meta.id).not.toBe(second.meta.id);
    expect(manager.load(first.meta.id)).toBe(first);
    expect(manager.load(second.meta.id)).toBe(second);
    expect(manager.listSummaries()).toHaveLength(2);
});

test("persists session messages and caches loaded sessions", () => {
    home.path = join(base, "load-home");
    const manager = new SessionManager();
    const session = manager.create();
    const message: LlmUserMessage = {
        role: "user",
        content: "hello",
        timestamp: Date.now()
    };

    session.append(message);

    expect(manager.load(session.meta.id)).toBe(session);

    const reloaded = new SessionManager();
    const loaded = reloaded.load(session.meta.id);
    expect(loaded?.snapshot()).toEqual({
        meta: session.meta,
        messages: [message]
    });
    expect(reloaded.load(session.meta.id)).toBe(loaded);
});
