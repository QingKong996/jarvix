import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test, vi } from "vitest";
import type { LlmUserMessage } from "../../../protocol/llm.ts";

const readFileSyncCalls = vi.hoisted(() => [] as string[]);
const readSyncBytes = vi.hoisted(() => [] as number[]);

vi.mock("node:fs", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs")>();
    return {
        ...actual,
        readSync: ((...args: unknown[]) => {
            const bytes = (actual.readSync as (...params: unknown[]) => number)(...args);
            readSyncBytes.push(bytes);
            return bytes;
        }) as typeof actual.readSync,
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
    listSessionSummaries,
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
    const loaded = loadSession(created.meta.id, base);
    expect(loaded).toEqual({
        meta,
        messages: [message]
    });
    expect(readFileSyncCalls).toEqual([]);
});

test("rejects an unterminated header without reading the whole file", () => {
    const directory = join(base, "oversized-header");
    mkdirSync(directory, { recursive: true });
    writeFileSync(
        join(directory, "10000000-0000-4000-8000-000000000099.jsonl"),
        "x".repeat(16 * 1024 * 1024)
    );
    readSyncBytes.length = 0;

    expect(listSessionSummaries(directory)).toEqual([]);
    expect(readSyncBytes.reduce((total, bytes) => total + bytes, 0))
        .toBeLessThanOrEqual(1024 * 1024);
});
