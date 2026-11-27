import {
    closeSync,
    fstatSync,
    openSync,
    readdirSync,
    readSync,
    statSync,
    type Stats
} from "node:fs";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { LlmMessage } from "../../../protocol/llm.ts";
import type {
    JarvixSession,
    JarvixSessionMeta,
    JarvixSessionSummary
} from "../../../protocol/session.ts";
import { isStorageId } from "../../storage-id.ts";
import {
    defaultSessionDirectory,
    sessionFile,
    sessionMetaFileFor,
    SESSION_FILE_EXTENSION
} from "./paths.ts";
import {
    SESSION_HEADER_MAX_BYTES,
    assignMessageRecordId,
    isSessionCompactRecord,
    isSessionMessage,
    messageRecordId,
    parseRecord,
    parseSessionMeta
} from "./records.ts";

const SESSION_HEADER_CHUNK_SIZE = 4 * 1024;
const SESSION_LOAD_CHUNK_SIZE = 64 * 1024;
const SESSION_TAIL_CHUNK_SIZE = 64 * 1024;

type SessionSummaryCache = Map<string, {
    version: string;
    summary: JarvixSessionSummary | null;
}>;

const sessionSummaryCaches = new Map<string, SessionSummaryCache>();

/** Load a session, or null when the file is unreadable or has no valid session header. */
export function loadSession(
    id: string,
    directory = defaultSessionDirectory()
): JarvixSession | null {
    const file = sessionFile(id, directory);
    let descriptor: number;
    try {
        descriptor = openSync(file, "r");
    } catch {
        return null;
    }

    const state: { meta: JarvixSessionMeta | null } = {
        meta: readSessionSidecarMeta(file)
    };
    const messages: LlmMessage[] = [];
    let messageOrdinal = 0;
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
            assignMessageRecordId(
                record.message,
                record.id ?? `legacy:${messageOrdinal}`
            );
            messageOrdinal += 1;
            messages.push(record.message);
            return;
        }
        if (isSessionCompactRecord(record)) {
            applyCompaction(messages, record);
        }
    };

    try {
        const buffer = Buffer.allocUnsafe(SESSION_LOAD_CHUNK_SIZE);
        while (true) {
            const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
            if (bytesRead === 0) {
                break;
            }
            const chunk = buffer.subarray(0, bytesRead);
            let start = 0;
            while (start < bytesRead) {
                const newline = chunk.indexOf(0x0a, start);
                if (newline === -1) {
                    pending.push(Buffer.from(chunk.subarray(start)));
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

function applyCompaction(
    messages: LlmMessage[],
    record: {
        id: string;
        messageIds: readonly string[];
        message: LlmMessage;
    }
): void {
    if (record.messageIds.length === 0) {
        return;
    }
    const start = messages.findIndex(
        (message) => messageRecordId(message) === record.messageIds[0]
    );
    if (
        start === -1 ||
        start + record.messageIds.length > messages.length
    ) {
        return;
    }
    for (let index = 1; index < record.messageIds.length; index += 1) {
        if (messageRecordId(messages[start + index]!) !== record.messageIds[index]) {
            return;
        }
    }
    assignMessageRecordId(record.message, record.id);
    messages.splice(start, record.messageIds.length, record.message);
}

/** List session summaries newest first by their last message timestamp. */
export function listSessionSummaries(
    directory = defaultSessionDirectory()
): JarvixSessionSummary[] {
    let entries: string[];
    try {
        entries = readdirSync(directory);
    } catch {
        return [];
    }

    const candidates: { id: string; file: string; stats: Stats }[] = [];
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
        candidates.push({ id, file, stats });
    }

    const cache = sessionSummaryCacheFor(directory);
    const candidateFiles = new Set(candidates.map((candidate) => candidate.file));
    const summaries: JarvixSessionSummary[] = [];
    for (const candidate of candidates) {
        const summary = readSessionSummary(
            candidate.file,
            candidate.id,
            candidate.stats,
            cache
        );
        if (summary) {
            summaries.push(summary);
        }
    }
    for (const file of cache.keys()) {
        if (!candidateFiles.has(file)) {
            cache.delete(file);
        }
    }
    return summaries.sort(
        (left, right) =>
            right.updatedAt - left.updatedAt ||
            right.createdAt - left.createdAt
    );
}

/** List archived session summaries newest archive first. */
export function listArchivedSessionSummaries(
    directory = defaultSessionDirectory()
): JarvixSessionSummary[] {
    return listSessionSummaries(directory)
        .filter((session) => session.status === "archived")
        .sort(
            (left, right) =>
                (right.archivedAt ?? 0) - (left.archivedAt ?? 0) ||
                right.createdAt - left.createdAt
        );
}

/** Read the stored name and first user prompt without loading the full history. */
export function readSessionNamingContext(
    id: string,
    directory = defaultSessionDirectory()
): { name: string; firstPrompt: string | null } | null {
    const file = sessionFile(id, directory);
    const meta = readSessionMeta(file);
    if (!meta || meta.id !== id) {
        return null;
    }
    return {
        name: meta.name,
        firstPrompt: readFirstUserPrompt(file)
    };
}

/** Read session metadata from its sidecar, falling back to the legacy JSONL header. */
export function readSessionMeta(file: string): JarvixSessionMeta | null {
    return readSessionSidecarMeta(file) ?? parseSessionMeta(readFirstRecord(file));
}

function readSessionSidecarMeta(file: string): JarvixSessionMeta | null {
    return parseSessionMeta(readFirstRecord(sessionMetaFileFor(file)));
}

function readFirstRecord(file: string): unknown {
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
        return parseRecord(header);
    } catch {
        return null;
    } finally {
        closeSync(descriptor);
    }
}

function readSessionSummary(
    file: string,
    id: string,
    dataStats: Stats,
    cache: SessionSummaryCache
): JarvixSessionSummary | null {
    const metaStats = statsIfExists(sessionMetaFileFor(file));
    const version = `${fileVersion(dataStats)}|${fileVersion(metaStats)}`;
    const cached = cache.get(file);
    if (cached?.version === version) {
        return cached.summary;
    }

    const meta = readSessionMeta(file);
    if (!meta || meta.id !== id) {
        cache.set(file, { version, summary: null });
        return null;
    }
    const summary: JarvixSessionSummary = {
        id: meta.id,
        name: meta.name,
        createdAt: meta.createdAt,
        updatedAt: readLastMessageTimestamp(file) ?? meta.createdAt,
        status: meta.status,
        ...(meta.archivedAt !== undefined ? { archivedAt: meta.archivedAt } : {}),
        ...(meta.goal ? { goal: meta.goal } : {}),
        ...(meta.projectId ? { projectId: meta.projectId } : {}),
        ...(meta.workingDirectory ? { workingDirectory: meta.workingDirectory } : {})
    };
    cache.set(file, { version, summary });
    return summary;
}

function sessionSummaryCacheFor(directory: string): SessionSummaryCache {
    let cache = sessionSummaryCaches.get(directory);
    if (!cache) {
        cache = new Map();
        sessionSummaryCaches.set(directory, cache);
    }
    return cache;
}

function fileVersion(stats: Stats | undefined): string {
    return stats
        ? `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`
        : "";
}

function statsIfExists(file: string): Stats | undefined {
    try {
        return statSync(file, { throwIfNoEntry: false });
    } catch {
        return undefined;
    }
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
                if (isSessionCompactRecord(record)) {
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

function readFirstUserPrompt(file: string): string | null {
    let descriptor: number;
    try {
        descriptor = openSync(file, "r");
    } catch {
        return null;
    }

    const pending: Buffer[] = [];
    const consume = (line: Buffer): string | null => {
        const record = parseRecord(line.toString("utf8"));
        if (!isSessionMessage(record) || record.message.role !== "user") {
            return null;
        }
        return record.message.context === undefined
            ? record.message.content
            : null;
    };

    try {
        const buffer = Buffer.allocUnsafe(SESSION_LOAD_CHUNK_SIZE);
        while (true) {
            const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
            if (bytesRead === 0) {
                break;
            }
            const chunk = buffer.subarray(0, bytesRead);
            let start = 0;
            while (start < bytesRead) {
                const newline = chunk.indexOf(0x0a, start);
                if (newline === -1) {
                    pending.push(Buffer.from(chunk.subarray(start)));
                    break;
                }
                let prompt: string | null;
                if (pending.length === 0) {
                    prompt = consume(chunk.subarray(start, newline));
                } else {
                    pending.push(chunk.subarray(start, newline));
                    prompt = consume(Buffer.concat(pending));
                    pending.length = 0;
                }
                if (prompt !== null) {
                    return prompt;
                }
                start = newline + 1;
            }
        }
        return pending.length > 0 ? consume(Buffer.concat(pending)) : null;
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
