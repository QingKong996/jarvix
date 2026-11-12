import { createLlm, type LlmAdapter } from "../llm/index.ts";
import type { JarvixConfig } from "../protocol/config.ts";
import type { JarvixEvent, JarvixListener } from "../protocol/event.ts";
import type { JarvixSession, JarvixSessionSummary } from "../protocol/session.ts";
import { SessionManager } from "../session/manager.ts";

export type JarvixOptions = {
    llm?: LlmAdapter;
    config?: JarvixConfig;
};

export class Jarvix {
    private readonly listeners = new Set<JarvixListener>();
    private config: JarvixConfig;
    private readonly llm: LlmAdapter;
    private readonly sessions = new SessionManager();

    constructor(options: JarvixOptions = {}) {
        this.config = options.config ?? {};
        this.llm = options.llm ?? createLlm();
    }

    setConfig(config: JarvixConfig): void {
        this.config = config;
    }

    createSession(): JarvixSession {
        return this.sessions.create().snapshot();
    }

    loadSession(sessionId: string): JarvixSession | null {
        return this.sessions.load(sessionId)?.snapshot() ?? null;
    }

    listSessions(): JarvixSessionSummary[] {
        return this.sessions.listSummaries();
    }

    private emit(sessionId: string, event: JarvixEvent): void {
        for (const listener of this.listeners) {
            listener(event, sessionId);
        }
    }

    subscribe(listener: JarvixListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    async request(question: string, sessionId: string): Promise<void> {
        const session = this.sessions.require(sessionId);
        await session.request(question, {
            llm: this.llm,
            config: this.config,
            emit: (event) => this.emit(session.meta.id, event)
        });
    }
}
