import type { JarvixConfig } from "./config.ts";
import type { JarvixEvent } from "./event.ts";
import type { JarvixSession, JarvixSessionSummary } from "./session.ts";

export const IPC_CHANNELS = {
    request: "jarvix:request",
    event: "jarvix:event",
    configGet: "jarvix:config:get",
    configSet: "jarvix:config:set",
    sessionCreate: "jarvix:session:create",
    sessionOpen: "jarvix:session:open",
    sessionsList: "jarvix:sessions:list"
} as const;

export type JarvixEventBatch = {
    sessionId: string;
    events: JarvixEvent[];
};

export type JarvixBridge = {
    request(question: string, sessionId: string): Promise<void>;
    onEvents(listener: (batch: JarvixEventBatch) => void): () => void;
    getConfig(): Promise<JarvixConfig>;
    setConfig(config: JarvixConfig): Promise<JarvixConfig>;
    createSession(): Promise<JarvixSession>;
    openSession(sessionId: string): Promise<JarvixSession | null>;
    listSessions(): Promise<JarvixSessionSummary[]>;
};
