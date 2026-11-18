import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test, vi } from "vitest";
import type { LlmUserMessage } from "../../llm/types.ts";

const readFileSyncCalls = vi.hoisted(() => [] as string[]);

vi.mock("node:fs", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs")>();
    return {
        ...actual,
        readFileSync: ((...args: unknown[]) => {
            const [file] = args;
            readFileSyncCalls.push(String(file));
            return (actual.readFileSync as (...params: unknown[]) => unknown)(...args);
        }) as typeof actual.readFileSync
    };
});

const {
    appendSessionMessage,
    createSession,
    loadSession,
    updateSessionName
} = await import("./store.ts");

const base = mkdtempSync(join(tmpdir(), "jarvix-session-streaming-"));

afterAll(() => {
    rmSync(base, { recursive: true, force: true });
});

test("metadata updates stream large histories without reading them into memory", () => {
    const created = createSession({}, "Large session", base);
    const message: LlmUserMessage = {
        role: "user",
        content: "history ".repeat(256 * 1024),
        timestamp: 1_700_000_000_000
    };
    appendSessionMessage(created.meta.id, message, base);
    readFileSyncCalls.length = 0;

    const meta = updateSessionName(created.meta.id, "Renamed large session", base);

    expect(readFileSyncCalls).toEqual([]);
    expect(loadSession(created.meta.id, base)).toEqual({
        meta,
        messages: [message]
    });
});
