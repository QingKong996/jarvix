import type { JarvixConfig } from "./config.ts";
import type { JarvixEvent } from "./event.ts";
import type { JarvixProject } from "./project.ts";
import type { ModelCatalog, ModelDefinition, ProviderModelSyncRequest } from "./providers.ts";
import type { JarvixSession, JarvixSessionContext, JarvixSessionSummary } from "./session.ts";

export const IPC_CHANNELS = {
    request: "jarvix:request",
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
    openSession(sessionId: string): Promise<JarvixSession | null>;
    listSessions(): Promise<JarvixSessionSummary[]>;
};
