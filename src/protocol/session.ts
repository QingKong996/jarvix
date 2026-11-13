import type { LlmMessage } from "../llm/types.ts";

/** Session header, stored as the first line of a session file. */
export type JarvixSessionMeta = {
    type: "session";
    version: number;
    id: string;
    /** Non-empty display name. */
    name: string;
    createdAt: number;
};

/** A session loaded into memory. */
export type JarvixSession = {
    meta: JarvixSessionMeta;
    messages: LlmMessage[];
};

/** Lightweight session data for the sidebar; messages stay on disk. */
export type JarvixSessionSummary = {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
};
