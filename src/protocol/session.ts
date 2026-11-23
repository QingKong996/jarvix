import { z } from "zod";
import type { LlmMessage } from "./llm.ts";
import type { JarvixContextUsage } from "./context-usage.ts";
import type { PermissionMode } from "./permission.ts";

export const SESSION_NAME_MAX_LENGTH = 80;

export const sessionNameSchema = z.string().trim().min(1).max(SESSION_NAME_MAX_LENGTH);

export const SESSION_STATUSES = ["active", "archived"] as const;
export type JarvixSessionStatus = (typeof SESSION_STATUSES)[number];

/** Project or one-off working directory associated with a session. */
export const sessionContextSchema = z
    .object({
        projectId: z.string().trim().min(1).optional(),
        workingDirectory: z.string().trim().min(1).optional()
    })
    .refine(
        (context) => !(context.projectId && context.workingDirectory),
        "Session cannot use both a project and a custom working directory"
    )
    .transform(({ projectId, workingDirectory }) => ({
        ...(projectId ? { projectId } : {}),
        ...(workingDirectory ? { workingDirectory } : {})
    }));

export type JarvixSessionContext = z.infer<typeof sessionContextSchema>;

export function sessionContextFrom(context: JarvixSessionContext): JarvixSessionContext {
    return sessionContextSchema.parse(context);
}

/** Session header, stored as the first line of a session file. */
export type JarvixSessionMeta = JarvixSessionContext & {
    type: "session";
    version: number;
    id: string;
    /** Non-empty display name. */
    name: string;
    createdAt: number;
    status: JarvixSessionStatus;
    archivedAt?: number;
    permission: PermissionMode;
};

/** A session loaded into memory. */
export type JarvixSession = {
    meta: JarvixSessionMeta;
    messages: LlmMessage[];
    contextUsage?: JarvixContextUsage;
};

/** Lightweight session data for the sidebar; messages stay on disk. */
export type JarvixSessionSummary = JarvixSessionContext & {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    status: JarvixSessionStatus;
    archivedAt?: number;
};
