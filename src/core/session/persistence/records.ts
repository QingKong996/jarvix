import { resolve } from "node:path";
import type { LlmMessage } from "../../../llm/types.ts";
import {
    permissionModeOrDefault,
    type PermissionMode
} from "../../../protocol/permission.ts";
import {
    type JarvixSessionContext,
    type JarvixSessionMeta,
    sessionContextSchema
} from "../../../protocol/session.ts";

export const SESSION_HEADER_MAX_BYTES = 1024 * 1024;

export type SessionMessageRecord = {
    type: "message";
    message: LlmMessage;
};

export type SessionRecord = JarvixSessionMeta | SessionMessageRecord;

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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
