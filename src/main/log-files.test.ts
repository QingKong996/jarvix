import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import {
    archiveLogFile,
    logFileName,
    pruneExpiredLogFiles
} from "./log-files.ts";

const base = await mkdtemp(join(tmpdir(), "jarvix-log-files-"));

afterAll(() => rm(base, { recursive: true, force: true }));

test("uses the local calendar date as the log file name", () => {
    expect(logFileName(new Date(2026, 10, 23, 23, 59))).toBe("2026-11-23.log");
});

test("splits a log into numbered parts without overwriting earlier parts", async () => {
    const directory = join(base, "split");
    await mkdir(directory, { recursive: true });
    const active = join(directory, "2026-11-23.log");

    await writeFile(active, "first part");
    expect(archiveLogFile(active)).toBe(
        join(directory, "2026-11-23.1.log")
    );

    await writeFile(active, "second part");
    expect(archiveLogFile(active)).toBe(
        join(directory, "2026-11-23.2.log")
    );

    await expect(readFile(join(directory, "2026-11-23.1.log"), "utf8"))
        .resolves.toBe("first part");
    await expect(readFile(join(directory, "2026-11-23.2.log"), "utf8"))
        .resolves.toBe("second part");
});

test("deletes dated logs older than 90 days and preserves current files", async () => {
    const directory = join(base, "retention");
    await mkdir(directory, { recursive: true });
    const files = [
        "2025-12-31.log",
        "2025-12-31.1.log",
        "2025-12-31.old.log",
        "2026-01-01.log",
        "2026-01-01.1.log",
        "2026-01-01.old.log",
        "2026-03-31.log",
        "2026-03-31.2.log",
        "2026-02-30.log",
        "notes.txt"
    ];
    await Promise.all(files.map((name) => writeFile(join(directory, name), name)));

    await expect(
        pruneExpiredLogFiles(directory, new Date(2026, 3, 1, 12))
    ).resolves.toEqual([
        "2025-12-31.1.log",
        "2025-12-31.log",
        "2025-12-31.old.log"
    ]);
    await expect(readdir(directory)).resolves.toEqual(expect.arrayContaining([
        "2026-01-01.log",
        "2026-01-01.1.log",
        "2026-01-01.old.log",
        "2026-03-31.log",
        "2026-03-31.2.log",
        "2026-02-30.log",
        "notes.txt"
    ]));
});
