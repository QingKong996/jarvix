import { randomUUID } from "node:crypto";
import {
    appendFileSync,
    closeSync,
    fstatSync,
    mkdirSync,
    openSync,
    readdirSync,
    readSync,
    renameSync,
    statSync,
    unlinkSync,
    writeSync,
    writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { i18n } from "../../i18n/index.ts";
import type { LlmMessage } from "../../llm/types.ts";
import {
    DEFAULT_PERMISSION_MODE,
    permissionModeOrDefault,
    permissionModeSchema,
    type PermissionMode
} from "../../protocol/permission.ts";
import {
    type JarvixSession,
    type JarvixSessionContext,
    type JarvixSessionMeta,
    type JarvixSessionSummary,
    type JarvixSessionStatus,
    sessionContextSchema,
    sessionNameSchema
} from "../../protocol/session.ts";
import { assertStorageId, isStorageId } from "../storage-id.ts";

export const SESSION_FORMAT_VERSION = 3;

const SESSION_FILE_EXTENSION = ".jsonl";
const SESSION_FILE_MODE = 0o600;
const SESSION_HEADER_CHUNK_SIZE = 4 * 1024;
const SESSION_HEADER_MAX_BYTES = 1024 * 1024;
const SESSION_LOAD_CHUNK_SIZE = 64 * 1024;
const SESSION_TAIL_CHUNK_SIZE = 64 * 1024;
const SESSION_COPY_CHUNK_SIZE = 64 * 1024;

type SessionMessageRecord = {
    type: "message";
    message: LlmMessage;
};

type SessionRecord = JarvixSessionMeta | SessionMessageRecord;

/** Path of the `.jsonl` file backing the session with `id`. */
export function sessionFile(id: string, directory = defaultSessionDirectory()): string {
    return join(
        directory,
        `${assertStorageId(id, "session")}${SESSION_FILE_EXTENSION}`
    );
}

/** Create a new empty session with an optional project or custom working directory. */
export function createSession(
    context: JarvixSessionContext = {},
    name = "",
    directory = defaultSessionDirectory(),
    permission: PermissionMode = DEFAULT_PERMISSION_MODE
): JarvixSession {
    const normalizedContext = normalizeSessionContext(context);
    const meta: JarvixSessionMeta = {
        type: "session",
        version: SESSION_FORMAT_VERSION,
        id: randomUUID(),
        name: name.trim() || i18n.t("sessions.untitled"),
        createdAt: Date.now(),
        status: "active",
        permission: permissionModeSchema.parse(permission),
        ...normalizedContext
    };

    mkdirSync(directory, { recursive: true });
    writeFileSync(sessionFile(meta.id, directory), serializeRecord(meta), {
        encoding: "utf8",
        mode: SESSION_FILE_MODE
    });

    return { meta, messages: [] };
}

/** Replace a session's project or custom working directory. */
export function updateSessionContext(
    id: string,
    context: JarvixSessionContext,
    directory = defaultSessionDirectory()
): JarvixSessionMeta {
    const file = sessionFile(id, directory);
    const current = readSessionMeta(file);
    if (!current || current.id !== id) {
        throw new Error(`Session not found: ${id}`);
    }

    const normalizedContext = normalizeSessionContext(context);
    const meta: JarvixSessionMeta = {
        ...current,
        version: SESSION_FORMAT_VERSION
    };
    delete meta.projectId;
    delete meta.workingDirectory;
    Object.assign(meta, normalizedContext);

    writeSessionMeta(file, meta);
    return meta;
}

/** Replace a session's permission without changing its messages. */
export function updateSessionPermission(
    id: string,
    permission: PermissionMode,
    directory = defaultSessionDirectory()
): JarvixSessionMeta {
    const file = sessionFile(id, directory);
    const current = readSessionMeta(file);
    if (!current || current.id !== id) {
        throw new Error(`Session not found: ${id}`);
    }

    const meta: JarvixSessionMeta = {
        ...current,
        version: SESSION_FORMAT_VERSION,
        permission: permissionModeSchema.parse(permission)
    };
    writeSessionMeta(file, meta);
    return meta;
}

/** Replace a session's display name while preserving its messages. */
export function updateSessionName(
    id: string,
    name: string,
    directory = defaultSessionDirectory()
): JarvixSessionMeta {
    const file = sessionFile(id, directory);
    const current = readSessionMeta(file);
    if (!current || current.id !== id) {
        throw new Error(`Session not found: ${id}`);
    }

    const meta: JarvixSessionMeta = {
        ...current,
        version: SESSION_FORMAT_VERSION,
        name: sessionNameSchema.parse(name)
    };
    writeSessionMeta(file, meta);
    return meta;
}

/** Replace a session name only when its persisted value still matches the expected name. */
export function updateSessionNameIfUnchanged(
    id: string,
    expectedName: string,
    name: string,
    directory = defaultSessionDirectory()
): { meta: JarvixSessionMeta; updated: boolean } {
    const file = sessionFile(id, directory);
    const current = readSessionMeta(file);
    if (!current || current.id !== id) {
        throw new Error(`Session not found: ${id}`);
    }
    if (current.name !== expectedName) {
        return { meta: current, updated: false };
    }

    const meta: JarvixSessionMeta = {
        ...current,
        version: SESSION_FORMAT_VERSION,
        name: sessionNameSchema.parse(name)
    };
    writeSessionMeta(file, meta);
    return { meta, updated: true };
}

/** Change a session's archive state while preserving its messages. */
export function updateSessionStatus(
    id: string,
    status: JarvixSessionStatus,
    directory = defaultSessionDirectory(),
    archivedAt = Date.now()
): JarvixSessionMeta {
    const file = sessionFile(id, directory);
    const current = readSessionMeta(file);
    if (!current || current.id !== id) {
        throw new Error(`Session not found: ${id}`);
    }

    const meta: JarvixSessionMeta = {
        ...current,
        version: SESSION_FORMAT_VERSION,
        status
    };
    if (status === "archived") {
        meta.archivedAt = archivedAt;
    } else {
        delete meta.archivedAt;
    }

    writeSessionMeta(file, meta);
    return meta;
}

/** Permanently remove a session file and all of its messages. */
export function deleteSession(id: string, directory = defaultSessionDirectory()): void {
    const file = sessionFile(id, directory);
    const current = readSessionMeta(file);
    if (!current || current.id !== id) {
        throw new Error(`Session not found: ${id}`);
    }
    unlinkSync(file);
}

function writeSessionMeta(file: string, meta: JarvixSessionMeta): void {
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
        const source = openSync(file, "r");
        try {
            const sourceMode = fstatSync(source).mode & 0o777;
            const target = openSync(temporary, "wx", sourceMode || SESSION_FILE_MODE);
            try {
                writeAll(target, Buffer.from(serializeRecord(meta), "utf8"));
                copySessionBody(source, target);
            } finally {
                closeSync(target);
            }
        } finally {
            closeSync(source);
        }
        renameSync(temporary, file);
    } catch (error) {
        try {
            unlinkSync(temporary);
        } catch {
            // The temporary file may not have been created.
        }
        throw error;
    }
}

function copySessionBody(source: number, target: number): void {
    const buffer = Buffer.allocUnsafe(SESSION_COPY_CHUNK_SIZE);
    let copyingBody = false;
    while (true) {
        const bytesRead = readSync(source, buffer, 0, buffer.length, null);
        if (bytesRead === 0) {
            return;
        }
        const chunk = buffer.subarray(0, bytesRead);
        if (copyingBody) {
            writeAll(target, chunk);
            continue;
        }

        const newline = chunk.indexOf(0x0a);
        if (newline === -1) {
            continue;
        }
        copyingBody = true;
        if (newline + 1 < bytesRead) {
            writeAll(target, chunk.subarray(newline + 1));
        }
    }
}

function writeAll(descriptor: number, buffer: Buffer): void {
    let offset = 0;
    while (offset < buffer.length) {
        const bytesWritten = writeSync(
            descriptor,
            buffer,
            offset,
            buffer.length - offset
        );
        if (bytesWritten === 0) {
            throw new Error("Failed to write session metadata");
        }
        offset += bytesWritten;
    }
}

/** Append one message to an existing session file as a new JSONL line. */
export function appendSessionMessage(id: string, message: LlmMessage, directory = defaultSessionDirectory()): void {
    const record: SessionMessageRecord = { type: "message", message };
    const file = sessionFile(id, directory);
    appendFileSync(file, `${trailingRecordSeparator(file)}${serializeRecord(record)}`, {
        encoding: "utf8",
        mode: SESSION_FILE_MODE
    });
}

/** Load a session, or null when the file is unreadable or has no valid session header. */
export function loadSession(id: string, directory = defaultSessionDirectory()): JarvixSession | null {
    const file = sessionFile(id, directory);
    let descriptor: number;
    try {
        descriptor = openSync(file, "r");
    } catch {
        return null;
    }

    const state: { meta: JarvixSessionMeta | null } = { meta: null };
    const messages: LlmMessage[] = [];
    const pending: Buffer[] = [];
    const consume = (line: Buffer): void => {
        const record = parseRecord(line.toString("utf8"));
        if (record === undefined) {
            return;
        }
        if (!state.meta) {
            state.meta = parseSessionMeta(record);
            return;
        }
        if (isSessionMessage(record)) {
            messages.push(record.message);
        }
    };

    try {
        while (true) {
            const buffer = Buffer.allocUnsafe(SESSION_LOAD_CHUNK_SIZE);
            const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
            if (bytesRead === 0) {
                break;
            }
            const chunk = buffer.subarray(0, bytesRead);
            let start = 0;
            while (start < bytesRead) {
                const newline = chunk.indexOf(0x0a, start);
                if (newline === -1) {
                    pending.push(chunk.subarray(start));
                    break;
                }
                if (pending.length === 0) {
                    consume(chunk.subarray(start, newline));
                } else {
                    pending.push(chunk.subarray(start, newline));
                    consume(Buffer.concat(pending));
                    pending.length = 0;
                }
                start = newline + 1;
            }
        }
        if (pending.length > 0) {
            consume(Buffer.concat(pending));
        }
    } catch {
        return null;
    } finally {
        closeSync(descriptor);
    }

    return state.meta?.id === id ? { meta: state.meta, messages } : null;
}

/** List session summaries newest first by their last message timestamp. */
export function listSessionSummaries(directory = defaultSessionDirectory()): JarvixSessionSummary[] {
    let entries: string[];
    try {
        entries = readdirSync(directory);
    } catch {
        return [];
    }

    const candidates: { id: string; file: string }[] = [];
    for (const entry of entries) {
        if (!entry.endsWith(SESSION_FILE_EXTENSION)) {
            continue;
        }
        const file = join(directory, entry);
        let stats;
        try {
            stats = statSync(file);
        } catch {
            continue;
        }
        if (!stats.isFile()) {
            continue;
        }
        const id = entry.slice(0, -SESSION_FILE_EXTENSION.length);
        if (!isStorageId(id)) {
            continue;
        }
        candidates.push({
            id,
            file
        });
    }

    const summaries: JarvixSessionSummary[] = [];
    for (const candidate of candidates) {
        const summary = readSessionSummary(candidate.file, candidate.id);
        if (summary) {
            summaries.push(summary);
        }
    }
    return summaries.sort(
        (left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt
    );
}

/** List archived session summaries newest archive first. */
export function listArchivedSessionSummaries(directory = defaultSessionDirectory()): JarvixSessionSummary[] {
    return listSessionSummaries(directory)
        .filter((session) => session.status === "archived")
        .sort(
            (left, right) =>
                (right.archivedAt ?? 0) - (left.archivedAt ?? 0)
                || right.createdAt - left.createdAt
        );
}

function defaultSessionDirectory(): string {
    return join(homedir(), ".jarvix", "sessions");
}

function readSessionSummary(file: string, id: string): JarvixSessionSummary | null {
    const meta = readSessionMeta(file);
    if (!meta || meta.id !== id) {
        return null;
    }
    return {
        id: meta.id,
        name: meta.name,
        createdAt: meta.createdAt,
        updatedAt: readLastMessageTimestamp(file) ?? meta.createdAt,
        status: meta.status,
        ...(meta.archivedAt !== undefined ? { archivedAt: meta.archivedAt } : {}),
        ...(meta.projectId ? { projectId: meta.projectId } : {}),
        ...(meta.workingDirectory ? { workingDirectory: meta.workingDirectory } : {})
    };
}

function readLastMessageTimestamp(file: string): number | null {
    let descriptor: number;
    try {
        descriptor = openSync(file, "r");
    } catch {
        return null;
    }

    try {
        const size = fstatSync(descriptor).size;
        const chunks: Array<{ start: number; buffer: Buffer }> = [];
        let loadedStart = size;
        let lineEnd = size;
        while (true) {
            let separator = findPreviousNewline(chunks, lineEnd);
            while (separator === null && loadedStart > 0) {
                const length = Math.min(SESSION_TAIL_CHUNK_SIZE, loadedStart);
                loadedStart -= length;
                const chunk = Buffer.allocUnsafe(length);
                readSync(descriptor, chunk, 0, length, loadedStart);
                chunks.unshift({ start: loadedStart, buffer: chunk });
                separator = findPreviousNewline([chunks[0]!], lineEnd);
            }

            const lineStart = separator === null ? 0 : separator + 1;
            if (lineEnd > lineStart) {
                const record = parseRecord(
                    bufferRange(chunks, lineStart, lineEnd).toString("utf8")
                );
                if (isSessionMessage(record)) {
                    return record.message.timestamp;
                }
            }
            if (separator === null) {
                return null;
            }
            lineEnd = separator;
        }
    } catch {
        return null;
    } finally {
        closeSync(descriptor);
    }
}

function findPreviousNewline(
    chunks: ReadonlyArray<{ start: number; buffer: Buffer }>,
    before: number
): number | null {
    for (let index = chunks.length - 1; index >= 0; index -= 1) {
        const chunk = chunks[index]!;
        const end = Math.min(chunk.start + chunk.buffer.length, before);
        if (end <= chunk.start) {
            continue;
        }
        const newline = chunk.buffer.lastIndexOf(0x0a, end - chunk.start - 1);
        if (newline >= 0) {
            return chunk.start + newline;
        }
    }
    return null;
}

function bufferRange(
    chunks: ReadonlyArray<{ start: number; buffer: Buffer }>,
    start: number,
    end: number
): Buffer {
    const result = Buffer.allocUnsafe(end - start);
    let offset = 0;
    for (const chunk of chunks) {
        const chunkEnd = chunk.start + chunk.buffer.length;
        const overlapStart = Math.max(start, chunk.start);
        const overlapEnd = Math.min(end, chunkEnd);
        if (overlapStart >= overlapEnd) {
            continue;
        }
        const length = overlapEnd - overlapStart;
        chunk.buffer.copy(
            result,
            offset,
            overlapStart - chunk.start,
            overlapEnd - chunk.start
        );
        offset += length;
    }
    return result;
}

/** Read only the first JSONL record, which holds the session meta. */
function readSessionMeta(file: string): JarvixSessionMeta | null {
    let descriptor: number;
    try {
        descriptor = openSync(file, "r");
    } catch {
        return null;
    }

    try {
        const buffer = Buffer.allocUnsafe(SESSION_HEADER_CHUNK_SIZE);
        const decoder = new StringDecoder("utf8");
        let header = "";
        let headerBytes = 0;
        while (true) {
            const remaining = SESSION_HEADER_MAX_BYTES - headerBytes;
            if (remaining === 0) {
                if (fstatSync(descriptor).size <= headerBytes) {
                    header += decoder.end();
                    break;
                }
                return null;
            }
            const bytes = readSync(
                descriptor,
                buffer,
                0,
                Math.min(buffer.length, remaining),
                null
            );
            if (bytes === 0) {
                header += decoder.end();
                break;
            }
            headerBytes += bytes;
            header += decoder.write(buffer.subarray(0, bytes));
            const newline = header.indexOf("\n");
            if (newline !== -1) {
                header = header.slice(0, newline);
                break;
            }
        }
        return parseSessionMeta(parseRecord(header));
    } catch {
        return null;
    } finally {
        closeSync(descriptor);
    }
}

function serializeRecord(record: SessionRecord): string {
    return `${JSON.stringify(record)}\n`;
}

function trailingRecordSeparator(file: string): string {
    const descriptor = openSync(file, "r");
    try {
        const size = fstatSync(descriptor).size;
        if (size === 0) {
            return "";
        }
        const lastByte = Buffer.allocUnsafe(1);
        readSync(descriptor, lastByte, 0, 1, size - 1);
        return lastByte[0] === 0x0a ? "" : "\n";
    } finally {
        closeSync(descriptor);
    }
}

function parseRecord(line: string): unknown {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
        return undefined;
    }
    try {
        return JSON.parse(trimmed) as unknown;
    } catch {
        return undefined;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSessionMeta(value: unknown): JarvixSessionMeta | null {
    if (!(
        isRecord(value) &&
        value.type === "session" &&
        typeof value.version === "number" &&
        typeof value.id === "string" &&
        value.id.length > 0 &&
        typeof value.createdAt === "number"
    )) {
        return null;
    }
    const name = typeof value.name === "string" ? value.name.trim() : "";
    if (name.length === 0) {
        return null;
    }
    const parsedContext = sessionContextSchema.safeParse({
        projectId: typeof value.projectId === "string" ? value.projectId : undefined,
        workingDirectory: typeof value.workingDirectory === "string" ? value.workingDirectory : undefined
    });
    const archivedAt = (
        typeof value.archivedAt === "number" &&
        Number.isFinite(value.archivedAt)
    ) ? value.archivedAt : undefined;
    const archived = (
        value.status === "archived" &&
        archivedAt !== undefined
    );
    return {
        type: "session",
        version: value.version,
        id: value.id,
        name,
        createdAt: value.createdAt,
        status: archived ? "archived" : "active",
        permission: permissionModeOrDefault(value.permission),
        ...(archived ? { archivedAt } : {}),
        ...(parsedContext.success ? parsedContext.data : {})
    };
}

function normalizeSessionContext(context: JarvixSessionContext): JarvixSessionContext {
    const normalized = sessionContextSchema.parse(context);
    return normalized.workingDirectory
        ? { workingDirectory: resolve(normalized.workingDirectory) }
        : normalized;
}

function isSessionMessage(value: unknown): value is SessionMessageRecord {
    return isRecord(value) && value.type === "message" && isLlmMessage(value.message);
}

function isLlmMessage(value: unknown): value is LlmMessage {
    if (!isRecord(value) || typeof value.timestamp !== "number") {
        return false;
    }
    if (value.role === "user") {
        return (
            typeof value.content === "string" &&
            (value.context === undefined || value.context === "system-reminder")
        );
    }
    if (value.role === "assistant") {
        return (
            Array.isArray(value.content) &&
            typeof value.provider === "string" &&
            typeof value.model === "string" &&
            typeof value.api === "string" &&
            isRecord(value.usage) &&
            typeof value.stopReason === "string"
        );
    }
    if (value.role === "toolResult") {
        return (
            typeof value.toolCallId === "string" &&
            typeof value.toolName === "string" &&
            typeof value.content === "string" &&
            typeof value.isError === "boolean"
        );
    }
    if (value.role === "system") {
        return typeof value.content === "string" && (
            value.context === undefined ||
            value.context === "environment"
        ) && (
            value.environmentKey === undefined ||
            typeof value.environmentKey === "string"
        ) && (
            value.notice === undefined ||
            (
                isRecord(value.notice) &&
                value.notice.kind === "background.task_exit" &&
                typeof value.notice.sessionId === "string" &&
                (value.notice.exitCode === null || typeof value.notice.exitCode === "number") &&
                (value.notice.errorMessage === null || typeof value.notice.errorMessage === "string") &&
                typeof value.notice.unreadCharacters === "number"
            )
        );
    }
    return false;
}
