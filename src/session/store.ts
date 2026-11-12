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
import type { LlmMessage } from "../llm/types.ts";
import {
    type JarvixSession,
    type JarvixSessionMeta,
    type JarvixSessionSummary
} from "../protocol/session.ts";

export const SESSION_FORMAT_VERSION = 1;

const SESSION_FILE_EXTENSION = ".jsonl";
const SESSION_FILE_MODE = 0o600;
const SUMMARY_CHUNK_SIZE = 64 * 1024;
const SUMMARY_TITLE_LENGTH = 60;

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
export function createSession(directory = defaultSessionDirectory()): JarvixSession {
    const meta: JarvixSessionMeta = {
        type: "session",
        version: SESSION_FORMAT_VERSION,
        id: randomUUID(),
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
            if (isSessionMeta(record)) {
                meta = record;
            }
            continue;
        }
        if (isSessionMessage(record)) {
            messages.push(record.message);
        }
    }

    return meta ? { meta, messages } : null;
}

/** List session metadata newest first without instantiating sessions or retaining messages. */
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
    let descriptor: number;
    try {
        descriptor = openSync(file, "r");
    } catch {
        return null;
    }

    const summary: {
        meta: JarvixSessionMeta | null;
        title: string | null;
        messageCount: number;
    } = {
        meta: null,
        title: null,
        messageCount: 0
    };
    let remainder = "";
    const decoder = new StringDecoder("utf8");

    const consumeLine = (line: string): void => {
        const record = parseRecord(line);
        if (record === undefined) {
            return;
        }
        if (!summary.meta) {
            if (isSessionMeta(record)) {
                summary.meta = record;
            }
            return;
        }
        if (!isSessionMessage(record)) {
            return;
        }
        summary.messageCount += 1;
        if (summary.title === null && record.message.role === "user") {
            summary.title = sessionTitle(record.message.content);
        }
    };

    try {
        const buffer = Buffer.allocUnsafe(SUMMARY_CHUNK_SIZE);
        while (true) {
            const bytes = readSync(descriptor, buffer, 0, buffer.length, null);
            if (bytes === 0) {
                break;
            }
            const text = remainder + decoder.write(buffer.subarray(0, bytes));
            const lines = text.split("\n");
            remainder = lines.pop() ?? "";
            for (const line of lines) {
                consumeLine(line);
            }
        }
        remainder += decoder.end();
        consumeLine(remainder);
    } catch {
        return null;
    } finally {
        closeSync(descriptor);
    }

    if (!summary.meta || summary.meta.id !== id) {
        return null;
    }
    return {
        id: summary.meta.id,
        title: summary.title,
        createdAt: summary.meta.createdAt,
        updatedAt,
        messageCount: summary.messageCount
    };
}

function sessionTitle(content: string): string | null {
    const normalized = content.replace(/\s+/g, " ").trim();
    if (normalized.length === 0) {
        return null;
    }
    const characters = [...normalized];
    return characters.length > SUMMARY_TITLE_LENGTH
        ? `${characters.slice(0, SUMMARY_TITLE_LENGTH).join("")}…`
        : normalized;
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

function isSessionMeta(value: unknown): value is JarvixSessionMeta {
    return (
        isRecord(value) &&
        value.type === "session" &&
        typeof value.version === "number" &&
        typeof value.id === "string" &&
        value.id.length > 0 &&
        typeof value.createdAt === "number"
    );
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
