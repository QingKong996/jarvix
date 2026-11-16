/**
 * OpenAI apply_patch compatibility.
 * Ported from https://github.com/openai/codex/tree/main/codex-rs/apply-patch
 * Format reference: https://developers.openai.com/api/docs/guides/tools-apply-patch
 */

export type UpdateFileChunk = {
    changeContext: string | null;
    oldLines: string[];
    newLines: string[];
    contextLineIndices: Array<[number, number]>;
    isEndOfFile: boolean;
};

export type ApplyPatchHunk =
    | {
        kind: "add";
        path: string;
        contents: string;
    }
    | {
        kind: "delete";
        path: string;
    }
    | {
        kind: "update";
        path: string;
        movePath: string | null;
        chunks: UpdateFileChunk[];
    };

export type ParsedApplyPatch = {
    hunks: ApplyPatchHunk[];
    environmentId: string | null;
};

export class ApplyPatchParseError extends Error {
    readonly lineNumber: number | undefined;

    constructor(message: string, lineNumber?: number) {
        super(message);
        this.name = "ApplyPatchParseError";
        this.lineNumber = lineNumber;
    }
}

const BEGIN_PATCH_MARKER = "*** Begin Patch";
const END_PATCH_MARKER = "*** End Patch";
const ADD_FILE_MARKER = "*** Add File: ";
const DELETE_FILE_MARKER = "*** Delete File: ";
const UPDATE_FILE_MARKER = "*** Update File: ";
const MOVE_TO_MARKER = "*** Move to: ";
const EOF_MARKER = "*** End of File";
const CHANGE_CONTEXT_MARKER = "@@ ";
const EMPTY_CHANGE_CONTEXT_MARKER = "@@";
const ENVIRONMENT_ID_MARKER = "*** Environment ID:";

type ParserMode = "not_started" | "started" | "add" | "delete" | "update" | "ended";

/** Parse the OpenAI apply_patch text format without touching the filesystem. */
export function parseApplyPatch(patch: string): ParsedApplyPatch {
    const lines = patchLines(patch);
    const hunks: ApplyPatchHunk[] = [];
    let environmentId: string | null = null;
    let mode: ParserMode = "not_started";
    let activeUpdateLine = 0;
    let lineNumber = 0;

    const currentUpdate = (): Extract<ApplyPatchHunk, { kind: "update" }> | null => {
        const hunk = hunks.at(-1);
        return hunk?.kind === "update" ? hunk : null;
    };

    const ensureUpdateIsNotEmpty = (currentMode: ParserMode, line: string): void => {
        if (currentMode !== "update") {
            return;
        }
        const hunk = currentUpdate();
        if (!hunk) {
            return;
        }
        if (hunk.chunks.length === 0) {
            throw new ApplyPatchParseError(
                `Update file hunk for path '${hunk.path}' is empty`,
                activeUpdateLine
            );
        }
        const lastChunk = hunk.chunks.at(-1);
        if (lastChunk && lastChunk.oldLines.length === 0 && lastChunk.newLines.length === 0) {
            throw new ApplyPatchParseError(
                line === END_PATCH_MARKER
                    ? "Update hunk does not contain any lines"
                    : `Unexpected line found in update hunk: '${line}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`,
                lineNumber
            );
        }
    };

    const handleHeader = (currentMode: ParserMode, line: string): ParserMode | null => {
        if (currentMode === "started" && line.startsWith(ENVIRONMENT_ID_MARKER)) {
            if (environmentId !== null) {
                throw new ApplyPatchParseError(
                    "apply_patch environment_id cannot be specified more than once"
                );
            }
            const value = line.slice(ENVIRONMENT_ID_MARKER.length).trim();
            if (value.length === 0) {
                throw new ApplyPatchParseError("apply_patch environment_id cannot be empty");
            }
            environmentId = value;
            return currentMode;
        }
        if (line === END_PATCH_MARKER) {
            ensureUpdateIsNotEmpty(currentMode, line);
            return "ended";
        }
        if (line.startsWith(ADD_FILE_MARKER)) {
            ensureUpdateIsNotEmpty(currentMode, line);
            hunks.push({
                kind: "add",
                path: line.slice(ADD_FILE_MARKER.length),
                contents: ""
            });
            return "add";
        }
        if (line.startsWith(DELETE_FILE_MARKER)) {
            ensureUpdateIsNotEmpty(currentMode, line);
            hunks.push({
                kind: "delete",
                path: line.slice(DELETE_FILE_MARKER.length)
            });
            return "delete";
        }
        if (line.startsWith(UPDATE_FILE_MARKER)) {
            ensureUpdateIsNotEmpty(currentMode, line);
            hunks.push({
                kind: "update",
                path: line.slice(UPDATE_FILE_MARKER.length),
                movePath: null,
                chunks: []
            });
            activeUpdateLine = lineNumber;
            return "update";
        }
        return null;
    };

    for (const line of lines) {
        lineNumber += 1;
        const trimmed = line.trim();

        switch (mode) {
            case "not_started":
                if (trimmed !== BEGIN_PATCH_MARKER) {
                    throw new ApplyPatchParseError(
                        "The first line of the patch must be '*** Begin Patch'"
                    );
                }
                mode = "started";
                break;
            case "started":
                mode = handleHeader(mode, trimmed) ?? invalidHunkHeader(line, lineNumber);
                break;
            case "add": {
                const nextMode = handleHeader(mode, trimmed);
                if (nextMode !== null) {
                    mode = nextMode;
                    break;
                }
                const hunk = hunks.at(-1);
                if (hunk?.kind !== "add") {
                    invalidHunkHeader(line, lineNumber);
                }
                if (!line.startsWith("+")) {
                    invalidHunkHeader(line, lineNumber);
                }
                hunk.contents += `${line.slice(1)}\n`;
                break;
            }
            case "delete":
                mode = handleHeader(mode, trimmed) ?? invalidHunkHeader(line, lineNumber);
                break;
            case "update": {
                const updateLine = line.trimEnd();
                const nextMode = handleHeader(mode, updateLine);
                if (nextMode !== null) {
                    mode = nextMode;
                    break;
                }
                const hunk = currentUpdate();
                if (!hunk) {
                    throw new ApplyPatchParseError(
                        `Expected update hunk to start with a @@ context marker, got: '${line}'`,
                        lineNumber
                    );
                }

                const lastChunk = hunk.chunks.at(-1);
                if (lastChunk?.isEndOfFile) {
                    if (updateLine.length === 0) {
                        break;
                    }
                    if (
                        updateLine !== EMPTY_CHANGE_CONTEXT_MARKER
                        && !updateLine.startsWith(CHANGE_CONTEXT_MARKER)
                    ) {
                        throw new ApplyPatchParseError(
                            `Expected update hunk to start with a @@ context marker, got: '${line}'`,
                            lineNumber
                        );
                    }
                }

                if (
                    hunk.chunks.length === 0
                    && hunk.movePath === null
                    && updateLine.startsWith(MOVE_TO_MARKER)
                ) {
                    hunk.movePath = updateLine.slice(MOVE_TO_MARKER.length);
                    break;
                }

                if (
                    (updateLine === EMPTY_CHANGE_CONTEXT_MARKER
                        || updateLine.startsWith(CHANGE_CONTEXT_MARKER))
                    && lastChunk
                    && lastChunk.oldLines.length === 0
                    && lastChunk.newLines.length === 0
                ) {
                    throw new ApplyPatchParseError(
                        `Unexpected line found in update hunk: '${line}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`,
                        lineNumber
                    );
                }

                if (updateLine === EMPTY_CHANGE_CONTEXT_MARKER) {
                    hunk.chunks.push(newUpdateChunk(null));
                    break;
                }
                if (updateLine.startsWith(CHANGE_CONTEXT_MARKER)) {
                    hunk.chunks.push(
                        newUpdateChunk(updateLine.slice(CHANGE_CONTEXT_MARKER.length))
                    );
                    break;
                }
                if (updateLine === EOF_MARKER) {
                    if (!lastChunk || (lastChunk.oldLines.length === 0 && lastChunk.newLines.length === 0)) {
                        throw new ApplyPatchParseError(
                            "Update hunk does not contain any lines",
                            lineNumber
                        );
                    }
                    lastChunk.isEndOfFile = true;
                    break;
                }
                if (line.length === 0) {
                    const chunk = updateChunkFor(hunk);
                    chunk.contextLineIndices.push([chunk.oldLines.length, chunk.newLines.length]);
                    chunk.oldLines.push("");
                    chunk.newLines.push("");
                    break;
                }
                if (line.startsWith(" ")) {
                    const chunk = updateChunkFor(hunk);
                    chunk.contextLineIndices.push([chunk.oldLines.length, chunk.newLines.length]);
                    chunk.oldLines.push(line.slice(1));
                    chunk.newLines.push(line.slice(1));
                    break;
                }
                if (line.startsWith("+")) {
                    updateChunkFor(hunk).newLines.push(line.slice(1));
                    break;
                }
                if (line.startsWith("-")) {
                    updateChunkFor(hunk).oldLines.push(line.slice(1));
                    break;
                }
                if (lastChunk && (lastChunk.oldLines.length > 0 || lastChunk.newLines.length > 0)) {
                    throw new ApplyPatchParseError(
                        `Expected update hunk to start with a @@ context marker, got: '${line}'`,
                        lineNumber
                    );
                }
                throw new ApplyPatchParseError(
                    `Unexpected line found in update hunk: '${line}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`,
                    lineNumber
                );
            }
            case "ended":
                if (trimmed.length > 0) {
                    throw new ApplyPatchParseError(
                        "The last line of the patch must be '*** End Patch'"
                    );
                }
                break;
        }
    }

    if (mode !== "ended") {
        throw new ApplyPatchParseError(
            "The last line of the patch must be '*** End Patch'"
        );
    }

    return { hunks, environmentId };
}

function invalidHunkHeader(line: string, lineNumber: number): never {
    throw new ApplyPatchParseError(
        `'${line.trim()}' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'`,
        lineNumber
    );
}

function newUpdateChunk(changeContext: string | null): UpdateFileChunk {
    return {
        changeContext,
        oldLines: [],
        newLines: [],
        contextLineIndices: [],
        isEndOfFile: false
    };
}

function updateChunkFor(
    hunk: Extract<ApplyPatchHunk, { kind: "update" }>
): UpdateFileChunk {
    const chunk = hunk.chunks.at(-1);
    if (chunk) {
        return chunk;
    }
    const created = newUpdateChunk(null);
    hunk.chunks.push(created);
    return created;
}

function patchLines(patch: string): string[] {
    const lines = splitLines(patch.trim());
    const first = lines[0]?.trim();
    const last = lines.at(-1)?.trim();

    if (first === BEGIN_PATCH_MARKER && last === END_PATCH_MARKER) {
        return lines;
    }
    if (isHeredocWrapper(lines)) {
        const inner = lines.slice(1, -1);
        const innerFirst = inner[0]?.trim();
        const innerLast = inner.at(-1)?.trim();
        if (innerFirst === BEGIN_PATCH_MARKER && innerLast === END_PATCH_MARKER) {
            return inner;
        }
        if (innerFirst !== BEGIN_PATCH_MARKER) {
            throw new ApplyPatchParseError(
                "The first line of the patch must be '*** Begin Patch'"
            );
        }
        throw new ApplyPatchParseError(
            "The last line of the patch must be '*** End Patch'"
        );
    }
    if (first !== BEGIN_PATCH_MARKER) {
        throw new ApplyPatchParseError(
            "The first line of the patch must be '*** Begin Patch'"
        );
    }
    throw new ApplyPatchParseError(
        "The last line of the patch must be '*** End Patch'"
    );
}

function isHeredocWrapper(lines: string[]): boolean {
    const first = lines[0];
    const last = lines.at(-1);
    return lines.length >= 4
        && (first === "<<EOF" || first === "<<'EOF'" || first === "<<\"EOF\"")
        && last !== undefined
        && last.endsWith("EOF");
}

function splitLines(value: string): string[] {
    return value.split("\n").map((line) => line.endsWith("\r") ? line.slice(0, -1) : line);
}
