import type { UpdateFileChunk } from "./apply-patch-parser.ts";

export type Replacement = [start: number, oldLength: number, lines: string[]];

export function computeReplacements(
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
