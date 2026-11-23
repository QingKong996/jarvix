import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { LlmMessage, LlmUserMessage } from "../../../protocol/llm.ts";
import { permissionModeOrDefault } from "../../../protocol/permission.ts";
import {
    type JarvixSessionContext,
    type JarvixSessionMeta,
    sessionContextSchema
} from "../../../protocol/session.ts";

export const SESSION_HEADER_MAX_BYTES = 1024 * 1024;

export type SessionMessageRecord = {
    type: "message";
    id?: string;
    message: LlmMessage;
};

export type SessionCompactRecord = {
    type: "compact";
    version: 1;
    id: string;
    messageIds: string[];
    message: LlmUserMessage;
};

export type SessionRecord = JarvixSessionMeta | SessionMessageRecord | SessionCompactRecord;

const messageRecordIds = new WeakMap<object, string>();

export function ensureMessageRecordId(message: object): string {
    const current = messageRecordIds.get(message);
    if (current) {
        return current;
    }
    const id = randomUUID();
    messageRecordIds.set(message, id);
    return id;
}

export function assignMessageRecordId(message: object, id: string): string {
    messageRecordIds.set(message, id);
    return id;
}

export function messageRecordId(message: object): string | undefined {
    return messageRecordIds.get(message);
}

export function serializeRecord(record: SessionRecord): string {
    return `${JSON.stringify(record)}\n`;
}

export function assertSessionMetaFits(contents: string): void {
    if (Buffer.byteLength(contents, "utf8") > SESSION_HEADER_MAX_BYTES) {
        throw new Error(
            `Session metadata exceeds the safe size limit of ${SESSION_HEADER_MAX_BYTES} bytes`
        );
    }
}

export function parseRecord(line: string): unknown {
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

export function parseSessionMeta(value: unknown): JarvixSessionMeta | null {
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

export function normalizeSessionContext(
    context: JarvixSessionContext
): JarvixSessionContext {
    const normalized = sessionContextSchema.parse(context);
    return normalized.workingDirectory
        ? { workingDirectory: resolve(normalized.workingDirectory) }
        : normalized;
}

export function isSessionMessage(value: unknown): value is SessionMessageRecord {
    return (
        isRecord(value) &&
        value.type === "message" &&
        (
            value.id === undefined ||
            (typeof value.id === "string" && value.id.length > 0)
        ) &&
        isLlmMessage(value.message)
    );
}

export function isSessionCompactRecord(value: unknown): value is SessionCompactRecord {
    return (
        isRecord(value) &&
        value.type === "compact" &&
        value.version === 1 &&
        typeof value.id === "string" &&
        value.id.length > 0 &&
        Array.isArray(value.messageIds) &&
        value.messageIds.every((id) => typeof id === "string" && id.length > 0) &&
        isLlmMessage(value.message) &&
        value.message.role === "user" &&
        value.message.context === "compact"
    );
}

function isLlmMessage(value: unknown): value is LlmMessage {
    if (!isRecord(value) || typeof value.timestamp !== "number") {
        return false;
    }
    if (value.role === "user") {
        return (
            typeof value.content === "string" &&
            (
                value.context === undefined ||
                value.context === "system-reminder" ||
                value.context === "compact"
            )
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
            isToolResultContent(value.content) &&
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

function isToolResultContent(value: unknown): boolean {
    if (typeof value === "string") {
        return true;
    }
    if (!Array.isArray(value)) {
        return false;
    }
    return value.every((block) => {
        if (!isRecord(block)) {
            return false;
        }
        if (block.type === "text") {
            return typeof block.text === "string";
        }
        if (block.type === "image") {
            return typeof block.data === "string" && typeof block.mimeType === "string";
        }
        return false;
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
