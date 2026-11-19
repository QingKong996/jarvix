import {
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type {
    ParsedApplyPatch,
    UpdateFileChunk
} from "./apply-patch-parser.ts";

type LineEnding = "\n" | "\r\n" | "\r";
const MAX_PATCH_FILE_BYTES = 16 * 1024 * 1024;

type SourceLine = {
    text: string;
    ending: LineEnding | null;
};

type SourceFile = {
    lines: SourceLine[];
    preferredEnding: LineEnding;
};

type Replacement = [start: number, oldLength: number, lines: string[]];

type AppliedFile = {
    newContents: string;
};

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

type PreparedPatch = {
    operations: PatchOperation[];
    spoolDirectory: string | null;
};

export type AffectedPaths = {
    added: string[];
    modified: string[];
    deleted: string[];
    aborted?: boolean;
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
                    deleteFile(operation.source, "Failed to remove original");
                    affected.modified.push(operation.displayPath);
                    break;
                }
            }
        }

        await yieldForCancellation(signal);
        affected.aborted = signal?.aborted ?? false;
        return affected;
    } finally {
        cleanupPreparedPatch(prepared);
    }
}

function prepareOperations(
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

            const applied = applyUpdate(target, hunk.chunks);
            spoolDirectory ??= mkdtempSync(
                join(tmpdir(), "jarvix-apply-patch-spool-")
            );
            const preparedPath = join(spoolDirectory, `${index}.bin`);
            try {
                writeFileSync(preparedPath, applied.newContents, "utf8");
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

function readPreparedContents(path: string): string {
    try {
        return readFileSync(path, "utf8");
    } catch (error) {
        throw new Error(`Failed to read prepared patch contents: ${errorMessage(error)}`);
    }
}

function cleanupPreparedPatch(prepared: PreparedPatch): void {
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

/** Format the git-style summary returned by OpenAI's apply_patch implementation. */
export function formatPatchSummary(affected: AffectedPaths): string {
    return [
        "Success. Updated the following files:",
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

function applyUpdate(
    path: string,
    chunks: readonly UpdateFileChunk[]
): AppliedFile {
    let originalContents: string;
    try {
        const size = statSync(path).size;
        if (size > MAX_PATCH_FILE_BYTES) {
            throw new Error(
                `Refusing to update ${path}: ${formatBytes(size)} exceeds the `
                + `${formatBytes(MAX_PATCH_FILE_BYTES)} limit.`
            );
        }
        originalContents = readFileSync(path, "utf8");
    } catch (error) {
        if (error instanceof Error && error.message.startsWith("Refusing to update ")) {
            throw error;
        }
        throw new Error(`Failed to read file to update ${path}: ${errorMessage(error)}`);
    }

    const sourceFile = parseSourceFile(originalContents);
    const replacements = computeReplacements(
        sourceFile.lines.map((line) => line.text),
        path,
        chunks
    );
    applyReplacements(sourceFile, replacements);
    return {
        newContents: serializeSourceFile(sourceFile)
    };
}

function computeReplacements(
    originalLines: readonly string[],
    path: string,
    chunks: readonly UpdateFileChunk[]
): Replacement[] {
    const replacements: Replacement[] = [];
    let lineIndex = 0;

    for (const chunk of chunks) {
        if (chunk.changeContext !== null) {
            const contextIndex = seekSequence(
                originalLines,
                [chunk.changeContext],
                lineIndex,
                false
            );
            if (contextIndex === undefined) {
                throw new Error(`Failed to find context '${chunk.changeContext}' in ${path}`);
            }
            lineIndex = contextIndex + 1;
        }

        if (chunk.oldLines.length === 0) {
            replacements.push([originalLines.length, 0, [...chunk.newLines]]);
            continue;
        }

        let pattern = chunk.oldLines;
        let newLines = chunk.newLines;
        let found = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile);

        if (found === undefined && pattern.at(-1) === "") {
            pattern = pattern.slice(0, -1);
            if (newLines.at(-1) === "") {
                newLines = newLines.slice(0, -1);
            }
            found = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile);
        }

        if (found === undefined) {
            throw new Error(
                `Failed to find expected lines in ${path}:\n${chunk.oldLines.join("\n")}`
            );
        }

        let oldStart = 0;
        let newStart = 0;
        for (const [oldContext, newContext] of chunk.contextLineIndices) {
            if (oldContext >= pattern.length || newContext >= newLines.length) {
                break;
            }
            if (oldStart !== oldContext || newStart !== newContext) {
                replacements.push([
                    found + oldStart,
                    oldContext - oldStart,
                    newLines.slice(newStart, newContext)
                ]);
            }
            oldStart = oldContext + 1;
            newStart = newContext + 1;
        }
        if (oldStart !== pattern.length || newStart !== newLines.length) {
            replacements.push([
                found + oldStart,
                pattern.length - oldStart,
                newLines.slice(newStart)
            ]);
        }
        lineIndex = found + pattern.length;
    }

    replacements.sort((left, right) => left[0] - right[0]);
    return replacements;
}

function seekSequence(
    lines: readonly string[],
    pattern: readonly string[],
    start: number,
    eof: boolean
): number | undefined {
    if (pattern.length === 0) {
        return start;
    }
    if (pattern.length > lines.length) {
        return undefined;
    }

    const searchStart = eof
        ? Math.max(start, lines.length - pattern.length)
        : start;
    const lastStart = lines.length - pattern.length;

    for (let index = searchStart; index <= lastStart; index += 1) {
        if (matchesSequence(lines, pattern, index, (value) => value)) {
            return index;
        }
    }
    for (let index = searchStart; index <= lastStart; index += 1) {
        if (matchesSequence(lines, pattern, index, (value) => value.trimEnd())) {
            return index;
        }
    }
    for (let index = searchStart; index <= lastStart; index += 1) {
        if (matchesSequence(lines, pattern, index, (value) => value.trim())) {
            return index;
        }
    }
    for (let index = searchStart; index <= lastStart; index += 1) {
        if (matchesSequence(lines, pattern, index, normalisePunctuation)) {
            return index;
        }
    }
    return undefined;
}

function matchesSequence(
    lines: readonly string[],
    pattern: readonly string[],
    start: number,
    normalise: (value: string) => string
): boolean {
    for (let offset = 0; offset < pattern.length; offset += 1) {
        if (normalise(lines[start + offset] ?? "") !== normalise(pattern[offset] ?? "")) {
            return false;
        }
    }
    return true;
}

function normalisePunctuation(value: string): string {
    return value
        .trim()
        .replace(/[\u2010-\u2015\u2212]/g, "-")
        .replace(/[\u2018-\u201b]/g, "'")
        .replace(/[\u201c-\u201f]/g, "\"")
        .replace(/[\u00a0\u2002-\u200a\u202f\u205f\u3000]/g, " ");
}

function parseSourceFile(contents: string): SourceFile {
    const lines: SourceLine[] = [];
    const endings = /\r\n|\r|\n/g;
    let lineStart = 0;
    let preferredEnding: LineEnding | null = null;
    let match: RegExpExecArray | null;

    while ((match = endings.exec(contents)) !== null) {
        const ending = match[0] as LineEnding;
        preferredEnding ??= ending;
        lines.push({
            text: contents.slice(lineStart, match.index),
            ending
        });
        lineStart = endings.lastIndex;
    }
    if (lineStart < contents.length) {
        lines.push({
            text: contents.slice(lineStart),
            ending: null
        });
    }

    return {
        lines,
        preferredEnding: preferredEnding ?? "\n"
    };
}

function applyReplacements(sourceFile: SourceFile, replacements: readonly Replacement[]): void {
    const sourceLines = sourceFile.lines;
    const nextLines: SourceLine[] = [];
    let sourceIndex = 0;

    for (const [start, oldLength, newLines] of replacements) {
        while (sourceIndex < start) {
            nextLines.push(sourceLines[sourceIndex]!);
            sourceIndex += 1;
        }
        sourceIndex += oldLength;
        for (const text of newLines) {
            nextLines.push({
                text,
                ending: sourceFile.preferredEnding
            });
        }
    }
    while (sourceIndex < sourceLines.length) {
        nextLines.push(sourceLines[sourceIndex]!);
        sourceIndex += 1;
    }

    for (const line of nextLines) {
        line.ending ??= sourceFile.preferredEnding;
    }
    sourceFile.lines = nextLines;
}

function serializeSourceFile(sourceFile: SourceFile): string {
    return sourceFile.lines
        .map((line) => `${line.text}${line.ending ?? ""}`)
        .join("");
}

function writeFile(path: string, contents: string, context: string): void {
    try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, contents, "utf8");
    } catch (error) {
        throw new Error(`${context} ${path}: ${errorMessage(error)}`);
    }
}

function createFile(path: string, contents: string): void {
    try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, contents, {
            encoding: "utf8",
            flag: "wx"
        });
    } catch (error) {
        throw new Error(`Failed to create file ${path}: ${errorMessage(error)}`);
    }
}

function deleteFile(path: string, context = "Failed to delete file"): void {
    try {
        assertDeleteTargetIsFile(path);
        rmSync(path);
    } catch (error) {
        throw new Error(`${context} ${path}: ${errorMessage(error)}`);
    }
}

function assertDeleteTargetIsFile(path: string): void {
    if (statSync(path).isDirectory()) {
        throw new Error("path is a directory");
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function formatBytes(bytes: number): string {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
