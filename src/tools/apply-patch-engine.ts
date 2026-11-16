import {
    mkdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync
} from "node:fs";
import { dirname, resolve } from "node:path";
import type {
    ApplyPatchHunk,
    ParsedApplyPatch,
    UpdateFileChunk
} from "./apply-patch-parser.ts";

type LineEnding = "\n" | "\r\n" | "\r";

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

export type AffectedPaths = {
    added: string[];
    modified: string[];
    deleted: string[];
};

/** Apply parsed OpenAI apply_patch hunks to the filesystem. */
export function applyParsedPatch(patch: ParsedApplyPatch, cwd: string): AffectedPaths {
    if (patch.hunks.length === 0) {
        throw new Error("No files were modified.");
    }

    const baseDirectory = resolve(cwd);
    assertUniqueTargets(patch.hunks, baseDirectory);
    const affected: AffectedPaths = {
        added: [],
        modified: [],
        deleted: []
    };

    for (const hunk of patch.hunks) {
        const target = resolve(baseDirectory, hunk.path);
        switch (hunk.kind) {
            case "add": {
                writeFile(target, hunk.contents, "Failed to write file");
                affected.added.push(hunk.path);
                break;
            }
            case "delete": {
                deleteFile(target);
                affected.deleted.push(hunk.path);
                break;
            }
            case "update": {
                const applied = applyUpdate(target, hunk.chunks);
                if (hunk.movePath === null) {
                    writeFile(target, applied.newContents, "Failed to write file");
                    affected.modified.push(hunk.path);
                    break;
                }
                const destination = resolve(baseDirectory, hunk.movePath);
                writeFile(destination, applied.newContents, "Failed to write file");
                deleteFile(target, "Failed to remove original");
                affected.modified.push(hunk.movePath);
                break;
            }
        }
    }

    return affected;
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

function assertUniqueTargets(hunks: readonly ApplyPatchHunk[], cwd: string): void {
    const targets = new Set<string>();
    for (const hunk of hunks) {
        const target = resolve(cwd, hunk.path);
        const key = process.platform === "win32" ? target.toLowerCase() : target;
        if (targets.has(key)) {
            throw new Error(`multiple operations target ${target}`);
        }
        targets.add(key);
    }
}

function applyUpdate(
    path: string,
    chunks: readonly UpdateFileChunk[]
): AppliedFile {
    let originalContents: string;
    try {
        originalContents = readFileSync(path, "utf8");
    } catch (error) {
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

function deleteFile(path: string, context = "Failed to delete file"): void {
    try {
        if (statSync(path).isDirectory()) {
            throw new Error("path is a directory");
        }
        rmSync(path);
    } catch (error) {
        throw new Error(`${context} ${path}: ${errorMessage(error)}`);
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
