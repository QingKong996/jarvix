import { lstatSync } from "node:fs";
import { resolve } from "node:path";
import type { ParsedApplyPatch } from "./apply-patch-parser.ts";
import {
    createFile,
    deleteFile,
    errorMessage,
    writeFile
} from "./file-operations.ts";
import {
    cleanupPreparedPatch,
    prepareOperations,
    readPreparedContents
} from "./prepared-patch.ts";

export type AffectedPaths = {
    added: string[];
    modified: string[];
    deleted: string[];
    aborted?: boolean;
    error?: string;
};

export type PatchWriteTarget = {
    path: string;
    operation: "add" | "delete" | "update" | "move source" | "move destination";
};

/** Resolve every path a patch would write or delete, before touching disk. */
export function patchWriteTargets(
    patch: ParsedApplyPatch,
    cwd: string
): PatchWriteTarget[] {
    const baseDirectory = resolve(cwd);
    const targets: PatchWriteTarget[] = [];
    for (const hunk of patch.hunks) {
        const target = resolve(baseDirectory, hunk.path);
        if (hunk.kind === "add") {
            targets.push({ path: target, operation: "add" });
        } else if (hunk.kind === "delete") {
            targets.push({ path: target, operation: "delete" });
        } else if (hunk.movePath === null) {
            targets.push({ path: target, operation: "update" });
        } else {
            targets.push({ path: target, operation: "move source" });
            targets.push({
                path: resolve(baseDirectory, hunk.movePath),
                operation: "move destination"
            });
        }
    }
    return targets;
}

/** Apply parsed OpenAI apply_patch hunks to the filesystem. */
export async function applyParsedPatch(
    patch: ParsedApplyPatch,
    cwd: string,
    signal?: AbortSignal
): Promise<AffectedPaths> {
    if (patch.hunks.length === 0) {
        throw new Error("No files were modified.");
    }

    const baseDirectory = resolve(cwd);
    assertUniqueTargets(patch, baseDirectory);
    assertNewTargetsAreAvailable(patch, baseDirectory);
    const affected: AffectedPaths = {
        added: [],
        modified: [],
        deleted: [],
        aborted: false
    };
    const prepared = prepareOperations(patch, baseDirectory);

    try {
        for (const operation of prepared.operations) {
            await yieldForCancellation(signal);
            if (signal?.aborted) {
                affected.aborted = true;
                return affected;
            }

            switch (operation.kind) {
                case "add": {
                    createFile(operation.path, operation.contents);
                    affected.added.push(operation.displayPath);
                    break;
                }
                case "delete": {
                    deleteFile(operation.path);
                    affected.deleted.push(operation.displayPath);
                    break;
                }
                case "update": {
                    writeFile(
                        operation.path,
                        readPreparedContents(operation.preparedPath),
                        "Failed to write file"
                    );
                    affected.modified.push(operation.displayPath);
                    break;
                }
                case "move": {
                    createFile(
                        operation.destination,
                        readPreparedContents(operation.preparedPath)
                    );
                    try {
                        deleteFile(operation.source, "Failed to remove original");
                    } catch (error) {
                        affected.added.push(operation.displayPath);
                        throw error;
                    }
                    affected.modified.push(operation.displayPath);
                    break;
                }
            }
        }

        await yieldForCancellation(signal);
        affected.aborted = signal?.aborted ?? false;
        return affected;
    } catch (error) {
        affected.error = errorMessage(error);
        return affected;
    } finally {
        cleanupPreparedPatch(prepared);
    }
}

/** Format the git-style summary returned by OpenAI's apply_patch implementation. */
export function formatPatchSummary(affected: AffectedPaths): string {
    return [
        "Success. Updated the following files:",
        formatPatchChanges(affected)
    ].join("\n");
}

export function formatPatchChanges(affected: AffectedPaths): string {
    return [
        ...affected.added.map((path) => `A ${path}`),
        ...affected.modified.map((path) => `M ${path}`),
        ...affected.deleted.map((path) => `D ${path}`)
    ].join("\n");
}

async function yieldForCancellation(signal?: AbortSignal): Promise<void> {
    if (!signal) {
        return;
    }
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 0));
}

function assertUniqueTargets(patch: ParsedApplyPatch, cwd: string): void {
    const targets = new Set<string>();
    for (const target of patchWriteTargets(patch, cwd)) {
        const key = process.platform === "win32"
            ? target.path.toLowerCase()
            : target.path;
        if (targets.has(key)) {
            throw new Error(`multiple operations target ${target.path}`);
        }
        targets.add(key);
    }
}

function assertNewTargetsAreAvailable(
    patch: ParsedApplyPatch,
    cwd: string
): void {
    for (const target of patchWriteTargets(patch, cwd)) {
        if (target.operation !== "add" && target.operation !== "move destination") {
            continue;
        }
        try {
            lstatSync(target.path);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                continue;
            }
            throw new Error(
                `Failed to inspect target ${target.path}: ${errorMessage(error)}`
            );
        }
        throw new Error(`Refusing to overwrite existing path ${target.path}`);
    }
}
