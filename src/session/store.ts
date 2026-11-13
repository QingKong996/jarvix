import { randomUUID } from "node:crypto";
import {
    appendFileSync,
    closeSync,
    mkdirSync,
    openSync,
    readFileSync,
    readdirSync,
    readSync,
    statSync,
    writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { i18n } from "../i18n/index.ts";
import type { LlmMessage } from "../llm/types.ts";
import {
    type JarvixSession,
    type JarvixSessionMeta,
    type JarvixSessionSummary
} from "../protocol/session.ts";

export const SESSION_FORMAT_VERSION = 1;

const SESSION_FILE_EXTENSION = ".jsonl";
const SESSION_FILE_MODE = 0o600;
const SESSION_HEADER_CHUNK_SIZE = 4 * 1024;

type SessionMessageRecord = {
    type: "message";
    message: LlmMessage;
};

type SessionRecord = JarvixSessionMeta | SessionMessageRecord;

/** Path of the `.jsonl` file backing the session with `id`. */
export function sessionFile(id: string, directory = defaultSessionDirectory()): string {
    return join(directory, `${id}${SESSION_FILE_EXTENSION}`);
}

/** Create a new empty session on disk and return it. */
export function createSession(name = "", directory = defaultSessionDirectory()): JarvixSession {
    const meta: JarvixSessionMeta = {
        type: "session",
        version: SESSION_FORMAT_VERSION,
        id: randomUUID(),
        name: name.trim() || i18n.t("sessions.untitled"),
        createdAt: Date.now()
    };

    mkdirSync(directory, { recursive: true });
    writeFileSync(sessionFile(meta.id, directory), serializeRecord(meta), {
        encoding: "utf8",
        mode: SESSION_FILE_MODE
    });

    return { meta, messages: [] };
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

/** List session summaries newest first by reading only each session header. */
export function listSessionSummaries(directory = defaultSessionDirectory()): JarvixSessionSummary[] {
    let entries: string[];
    try {
        entries = readdirSync(directory);
    } catch {
        return [];
    }

    const candidates: { id: string; file: string; updatedAt: number }[] = [];
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
            file,
            updatedAt: stats.mtimeMs
        });
    }

    candidates.sort((left, right) => right.updatedAt - left.updatedAt);
    const summaries: JarvixSessionSummary[] = [];
    for (const candidate of candidates) {
        const summary = readSessionSummary(candidate.file, candidate.id, candidate.updatedAt);
        if (summary) {
            summaries.push(summary);
        }
    }
    return summaries;
}

function defaultSessionDirectory(): string {
    return join(homedir(), ".jarvix", "sessions");
}

function readSessionSummary(file: string, id: string, updatedAt: number): JarvixSessionSummary | null {
    const meta = readSessionMeta(file);
    if (!meta || meta.id !== id) {
        return null;
    }
    return {
        id: meta.id,
        name: meta.name,
        createdAt: meta.createdAt,
        updatedAt
    };
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
    return {
        type: "session",
        version: value.version,
        id: value.id,
        name,
        createdAt: value.createdAt
    };
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
    return false;
}
