import {
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ParsedApplyPatch } from "./apply-patch-parser.ts";
import {
    assertDeleteTargetIsFile,
    errorMessage
} from "./file-operations.ts";
import { applyUpdate } from "./source-file.ts";

type PatchOperation =
    | {
        kind: "add";
        path: string;
        displayPath: string;
        contents: string;
    }
    | {
        kind: "delete";
        path: string;
        displayPath: string;
    }
    | {
        kind: "update";
        path: string;
        displayPath: string;
        preparedPath: string;
    }
    | {
        kind: "move";
        source: string;
        destination: string;
        displayPath: string;
        preparedPath: string;
    };

export type PreparedPatch = {
    operations: PatchOperation[];
    spoolDirectory: string | null;
};

export function prepareOperations(
    patch: ParsedApplyPatch,
    baseDirectory: string
): PreparedPatch {
    const operations: PatchOperation[] = [];
    let spoolDirectory: string | null = null;

    try {
        patch.hunks.forEach((hunk, index) => {
            const target = resolve(baseDirectory, hunk.path);
            if (hunk.kind === "add") {
                operations.push({
                    kind: "add",
                    path: target,
                    displayPath: hunk.path,
                    contents: hunk.contents
                });
                return;
            }
            if (hunk.kind === "delete") {
                assertDeleteTargetIsFile(target);
                operations.push({
                    kind: "delete",
                    path: target,
                    displayPath: hunk.path
                });
                return;
            }

            const newContents = applyUpdate(target, hunk.chunks);
            spoolDirectory ??= mkdtempSync(
                join(tmpdir(), "jarvix-apply-patch-spool-")
            );
            const preparedPath = join(spoolDirectory, `${index}.bin`);
            try {
                writeFileSync(preparedPath, newContents, "utf8");
            } catch (error) {
                throw new Error(
                    `Failed to prepare update for ${target}: ${errorMessage(error)}`
                );
            }

            if (hunk.movePath === null) {
                operations.push({
                    kind: "update",
                    path: target,
                    displayPath: hunk.path,
                    preparedPath
                });
                return;
            }
            operations.push({
                kind: "move",
                source: target,
                destination: resolve(baseDirectory, hunk.movePath),
                displayPath: hunk.movePath,
                preparedPath
            });
        });
        return { operations, spoolDirectory };
    } catch (error) {
        cleanupSpoolDirectory(spoolDirectory);
        throw error;
    }
}

export function readPreparedContents(path: string): string {
    try {
        return readFileSync(path, "utf8");
    } catch (error) {
        throw new Error(`Failed to read prepared patch contents: ${errorMessage(error)}`);
    }
}

export function cleanupPreparedPatch(prepared: PreparedPatch): void {
    cleanupSpoolDirectory(prepared.spoolDirectory);
}

function cleanupSpoolDirectory(directory: string | null): void {
    if (directory === null) {
        return;
    }
    try {
        rmSync(directory, {
            recursive: true,
            force: true,
            maxRetries: 3,
            retryDelay: 100
        });
    } catch {}
}
