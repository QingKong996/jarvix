import { randomUUID } from "node:crypto";
import {
    appendFileSync,
    closeSync,
    fstatSync,
    mkdirSync,
    openSync,
    readFileSync,
    readdirSync,
    readSync,
    renameSync,
    statSync,
    unlinkSync,
    writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { i18n } from "../i18n/index.ts";
import type { LlmMessage } from "../llm/types.ts";
import {
    type JarvixSession,
    type JarvixSessionContext,
    type JarvixSessionMeta,
    type JarvixSessionSummary,
    sessionContextSchema,
    sessionNameSchema
} from "../protocol/session.ts";

export const SESSION_FORMAT_VERSION = 2;

const SESSION_FILE_EXTENSION = ".jsonl";
const SESSION_FILE_MODE = 0o600;
const SESSION_HEADER_CHUNK_SIZE = 4 * 1024;
const SESSION_TAIL_CHUNK_SIZE = 64 * 1024;

type SessionMessageRecord = {
    type: "message";
    message: LlmMessage;
};

type SessionRecord = JarvixSessionMeta | SessionMessageRecord;

/** Path of the `.jsonl` file backing the session with `id`. */
export function sessionFile(id: string, directory = defaultSessionDirectory()): string {
    return join(directory, `${id}${SESSION_FILE_EXTENSION}`);
}

/** Create a new empty session with an optional project or custom working directory. */
export function createSession(
    context: JarvixSessionContext = {},
    name = "",
    directory = defaultSessionDirectory()
): JarvixSession {
    const normalizedContext = normalizeSessionContext(context);
    const meta: JarvixSessionMeta = {
        type: "session",
        version: SESSION_FORMAT_VERSION,
        id: randomUUID(),
        name: name.trim() || i18n.t("sessions.untitled"),
        createdAt: Date.now(),
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

function writeSessionMeta(file: string, meta: JarvixSessionMeta): void {
    const content = readFileSync(file, "utf8");
    const newline = content.indexOf("\n");
    const remainder = newline === -1 ? "" : content.slice(newline + 1);
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
        writeFileSync(temporary, `${serializeRecord(meta)}${remainder}`, {
            encoding: "utf8",
            mode: SESSION_FILE_MODE
        });
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

/** Append one message to an existing session file as a new JSONL line. */
export function appendSessionMessage(id: string, message: LlmMessage, directory = defaultSessionDirectory()): void {
    const record: SessionMessageRecord = { type: "message", message };
    appendFileSync(sessionFile(id, directory), serializeRecord(record), {
        encoding: "utf8",
        mode: SESSION_FILE_MODE
    });
}

/** Load a session, or null when the file is unreadable or has no valid session header. */
export function loadSession(id: string, directory = defaultSessionDirectory()): JarvixSession | null {
    let content: string;
    try {
        content = readFileSync(sessionFile(id, directory), "utf8");
    } catch {
        return null;
    }

    let meta: JarvixSessionMeta | null = null;
    const messages: LlmMessage[] = [];
    for (const line of content.split("\n")) {
        const record = parseRecord(line);
        if (record === undefined) {
            continue;
        }
        if (!meta) {
            meta = parseSessionMeta(record);
            continue;
        }
        if (isSessionMessage(record)) {
            messages.push(record.message);
        }
    }

    return meta ? { meta, messages } : null;
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
        candidates.push({
            id: entry.slice(0, -SESSION_FILE_EXTENSION.length),
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
        let position = fstatSync(descriptor).size;
        let suffix = Buffer.alloc(0);
        while (position > 0) {
            const length = Math.min(SESSION_TAIL_CHUNK_SIZE, position);
            position -= length;
            const chunk = Buffer.allocUnsafe(length);
            readSync(descriptor, chunk, 0, length, position);
            suffix = Buffer.concat([chunk, suffix]);

            let lineEnd = suffix.length;
            while (lineEnd > 0) {
                const lineStart = suffix.lastIndexOf(0x0a, lineEnd - 1) + 1;
                if (lineStart === 0 && position > 0) {
                    break;
                }
                const record = parseRecord(suffix.subarray(lineStart, lineEnd).toString("utf8"));
                if (isSessionMessage(record)) {
                    return record.message.timestamp;
                }
                lineEnd = lineStart - 1;
            }
        }
        return null;
    } catch {
        return null;
    } finally {
        closeSync(descriptor);
    }
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
        while (true) {
            const bytes = readSync(descriptor, buffer, 0, buffer.length, null);
            if (bytes === 0) {
                header += decoder.end();
                break;
            }
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
    return {
        type: "session",
        version: value.version,
        id: value.id,
        name,
        createdAt: value.createdAt,
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
        return typeof value.content === "string";
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
