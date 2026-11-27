import { randomUUID } from "node:crypto";
import { rmSync, unlinkSync } from "node:fs";
import { i18n } from "../../../i18n/index.ts";
import type { LlmMessage, LlmUserMessage } from "../../../protocol/llm.ts";
import {
    DEFAULT_PERMISSION_MODE,
    permissionModeSchema,
    type PermissionMode
} from "../../../protocol/permission.ts";
import {
    type JarvixGoal,
    type JarvixSession,
    type JarvixSessionContext,
    type JarvixSessionMeta,
    type JarvixSessionStatus,
    sessionGoalFrom,
    sessionNameSchema
} from "../../../protocol/session.ts";
import {
    defaultSessionDirectory,
    sessionFile,
    sessionMetaFileFor
} from "./paths.ts";
import { readSessionMeta } from "./reader.ts";
import {
    ensureMessageRecordId,
    messageRecordId,
    normalizeSessionContext,
    SESSION_FORMAT_VERSION,
    type SessionCompactRecord,
    type SessionMessageRecord
} from "./records.ts";
import {
    appendSessionRecord,
    createSessionFile,
    writeSessionMeta
} from "./writer.ts";

export { SESSION_FORMAT_VERSION } from "./records.ts";

export { defaultSessionDirectory, sessionFile } from "./paths.ts";
export {
    listArchivedSessionSummaries,
    listSessionSummaries,
    loadSession,
    readSessionNamingContext
} from "./reader.ts";

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

    createSessionFile(sessionFile(meta.id, directory), meta);
    return { meta, messages: [] };
}

/** Replace a session's project or custom working directory. */
export function updateSessionContext(
    id: string,
    context: JarvixSessionContext,
    directory = defaultSessionDirectory()
): JarvixSessionMeta {
    const file = sessionFile(id, directory);
    const current = requireSessionMeta(file, id);
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
    const current = requireSessionMeta(file, id);
    const meta: JarvixSessionMeta = {
        ...current,
        version: SESSION_FORMAT_VERSION,
        permission: permissionModeSchema.parse(permission)
    };
    writeSessionMeta(file, meta);
    return meta;
}

/** Replace the session goal while preserving its messages. */
export function updateSessionGoal(
    id: string,
    content: string,
    directory = defaultSessionDirectory()
): JarvixGoal {
    const file = sessionFile(id, directory);
    const current = requireSessionMeta(file, id);
    const goal = sessionGoalFrom(content, current.goal);
    const meta: JarvixSessionMeta = {
        ...current,
        version: SESSION_FORMAT_VERSION,
        goal
    };
    writeSessionMeta(file, meta);
    return goal;
}

/** Remove the session goal while preserving its messages. */
export function clearSessionGoal(
    id: string,
    directory = defaultSessionDirectory()
): JarvixSessionMeta {
    const file = sessionFile(id, directory);
    const current = requireSessionMeta(file, id);
    const meta: JarvixSessionMeta = {
        ...current,
        version: SESSION_FORMAT_VERSION
    };
    delete meta.goal;
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
    const current = requireSessionMeta(file, id);
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
    const current = requireSessionMeta(file, id);
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
    const current = requireSessionMeta(file, id);
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
export function deleteSession(
    id: string,
    directory = defaultSessionDirectory()
): void {
    const file = sessionFile(id, directory);
    requireSessionMeta(file, id);
    unlinkSync(file);
    rmSync(sessionMetaFileFor(file), { force: true });
}

/** Append one message to an existing session file as a new JSONL line. */
export function appendSessionMessage(
    id: string,
    message: LlmMessage,
    directory = defaultSessionDirectory()
): void {
    const recordId = messageRecordId(message);
    const record: SessionMessageRecord = {
        type: "message",
        ...(recordId ? { id: recordId } : {}),
        message
    };
    appendSessionRecord(sessionFile(id, directory), record);
}

export function appendSessionCompaction(
    id: string,
    message: LlmUserMessage,
    messageIds: readonly string[],
    directory = defaultSessionDirectory()
): void {
    const record: SessionCompactRecord = {
        type: "compact",
        version: 1,
        id: ensureMessageRecordId(message),
        messageIds: [...messageIds],
        message
    };
    appendSessionRecord(sessionFile(id, directory), record);
}

function requireSessionMeta(file: string, id: string): JarvixSessionMeta {
    const current = readSessionMeta(file);
    if (!current || current.id !== id) {
        throw new Error(`Session not found: ${id}`);
    }
    return current;
}
