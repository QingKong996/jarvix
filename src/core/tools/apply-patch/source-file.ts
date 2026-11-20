import { readFileSync, statSync } from "node:fs";
import type { UpdateFileChunk } from "./apply-patch-parser.ts";
import { errorMessage } from "./file-operations.ts";
import {
    computeReplacements,
    type Replacement
} from "./line-matching.ts";

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

export function applyUpdate(
    path: string,
    chunks: readonly UpdateFileChunk[]
): string {
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
    return serializeSourceFile(sourceFile);
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

function applyReplacements(
    sourceFile: SourceFile,
    replacements: readonly Replacement[]
): void {
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

function formatBytes(bytes: number): string {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
