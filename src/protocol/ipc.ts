import type { JarvixConfig } from "./config.ts";
import type { JarvixEvent } from "./event.ts";
import type { JarvixProject } from "./project.ts";
import type { ModelCatalog, ModelDefinition, ProviderModelSyncRequest } from "./providers.ts";
import type { JarvixSession, JarvixSessionContext, JarvixSessionSummary } from "./session.ts";

export const IPC_CHANNELS = {
    request: "jarvix:request",
    requestInject: "jarvix:request:inject",
    requestStop: "jarvix:request:stop",
    event: "jarvix:event",
    configGet: "jarvix:config:get",
    configSet: "jarvix:config:set",
    catalogGet: "jarvix:catalog:get",
    providerModelsSync: "jarvix:provider-models:sync",
    projectCreate: "jarvix:project:create",
    projectsList: "jarvix:projects:list",
    pickWorkingDirectories: "jarvix:working-directories:pick",
    pickWorkingDirectory: "jarvix:working-directory:pick",
    sessionCreate: "jarvix:session:create",
    sessionUpdateContext: "jarvix:session:update-context",
    sessionRename: "jarvix:session:rename",
    sessionAutoName: "jarvix:session:auto-name",
    sessionArchive: "jarvix:session:archive",
    sessionUnarchive: "jarvix:session:unarchive",
    sessionDelete: "jarvix:session:delete",
    sessionOpen: "jarvix:session:open",
    sessionsList: "jarvix:sessions:list",
    sessionsListArchived: "jarvix:sessions:list-archived"
} as const;

export type JarvixEventBatch = {
    sessionId: string;
    events: JarvixEvent[];
};

export type JarvixBridge = {
    request(question: string, sessionId: string): Promise<void>;
    injectPrompt(question: string, sessionId: string, promptId: string): Promise<boolean>;
    stopRequest(sessionId: string): Promise<void>;
    onEvents(listener: (batch: JarvixEventBatch) => void): () => void;
    getConfig(): Promise<JarvixConfig>;
    getModelCatalog(force?: boolean): Promise<ModelCatalog>;
    syncProviderModels(provider: ProviderModelSyncRequest): Promise<ModelDefinition[]>;
    setConfig(config: JarvixConfig): Promise<JarvixConfig>;
    createProject(name: string, workingDirectories: string[]): Promise<JarvixProject>;
    listProjects(): Promise<JarvixProject[]>;
    pickWorkingDirectories(): Promise<string[]>;
    pickWorkingDirectory(): Promise<string | null>;
    createSession(context?: JarvixSessionContext): Promise<JarvixSession>;
    updateSessionContext(
        sessionId: string,
        context: JarvixSessionContext
    ): Promise<JarvixSessionContext>;
    renameSession(sessionId: string, name: string): Promise<string>;
    autoNameSession(sessionId: string, firstPrompt?: string): Promise<string>;
    archiveSession(sessionId: string): Promise<void>;
    unarchiveSession(sessionId: string): Promise<void>;
    deleteSession(sessionId: string): Promise<void>;
    openSession(sessionId: string): Promise<JarvixSession | null>;
    listSessions(): Promise<JarvixSessionSummary[]>;
    listArchivedSessions(): Promise<JarvixSessionSummary[]>;
};
