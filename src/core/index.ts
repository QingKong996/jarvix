import { createLlm, type LlmAdapter } from "../llm/index.ts";
import { i18n } from "../i18n/index.ts";
import type { JarvixConfig } from "../protocol/config.ts";
import type { JarvixEvent, JarvixListener } from "../protocol/event.ts";
import type { JarvixProject } from "../protocol/project.ts";
import type {
    JarvixSession,
    JarvixSessionContext,
    JarvixSessionSummary
} from "../protocol/session.ts";
import { sessionContextSchema, sessionNameSchema } from "../protocol/session.ts";
import {
    createProject as createStoredProject,
    listProjects as listStoredProjects,
    loadProject
} from "../project/store.ts";
import { SessionManager } from "../session/manager.ts";
import { generateSessionName } from "../session/naming.ts";

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
        this.llm = options.llm ?? createLlm(() => this.config.providers);
    }

    setConfig(config: JarvixConfig): void {
        this.config = config;
    }

    createProject(name: string, workingDirectories: readonly string[]): JarvixProject {
        return createStoredProject(name, workingDirectories);
    }

    listProjects(): JarvixProject[] {
        return listStoredProjects();
    }

    createSession(context: JarvixSessionContext = {}, name?: string): JarvixSession {
        const normalizedContext = sessionContextSchema.parse(context);
        if (normalizedContext.projectId && !loadProject(normalizedContext.projectId)) {
            throw new Error(`Project not found: ${normalizedContext.projectId}`);
        }
        const sessionName = name?.trim() || i18n.t("sessions.untitled", { lng: this.config.language ?? "zh" });
        return this.sessions.create(normalizedContext, sessionName).snapshot();
    }

    loadSession(sessionId: string): JarvixSession | null {
        return this.sessions.load(sessionId)?.snapshot() ?? null;
    }

    listSessions(): JarvixSessionSummary[] {
        return this.sessions.listSummaries();
    }

    updateSessionContext(
        sessionId: string,
        context: JarvixSessionContext
    ): JarvixSessionContext {
        const normalizedContext = sessionContextSchema.parse(context);
        if (normalizedContext.projectId && !loadProject(normalizedContext.projectId)) {
            throw new Error(`Project not found: ${normalizedContext.projectId}`);
        }
        return this.sessions.updateContext(sessionId, normalizedContext);
    }

    renameSession(sessionId: string, name: string): string {
        const renamed = this.sessions.rename(sessionId, sessionNameSchema.parse(name));
        this.emit(sessionId, { type: "session.renamed", name: renamed });
        return renamed;
    }

    async autoNameSession(sessionId: string, firstPrompt?: string): Promise<string> {
        const session = this.sessions.require(sessionId);
        const currentName = session.meta.name;
        const prompt = firstPrompt?.trim() || session.snapshot().messages
            .find((message) => message.role === "user")?.content;
        if (!prompt) {
            throw new Error("The session has no user prompt to name");
        }

        const name = await generateSessionName(this.llm, this.config, prompt);
        if (session.meta.name !== currentName) {
            return session.meta.name;
        }
        return this.renameSession(sessionId, name);
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
        const project = session.meta.projectId ? loadProject(session.meta.projectId) : null;
        const workingDirectories = project?.workingDirectories
            ?? (session.meta.workingDirectory ? [session.meta.workingDirectory] : []);
        await session.request(question, {
            llm: this.llm,
            config: this.config,
            workingDirectories,
            emit: (event) => this.emit(session.meta.id, event)
        });
    }

    dispose(): void {
        this.sessions.dispose();
    }
}
