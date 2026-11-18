import type { JarvixConfig } from "./config.ts";
import type { JarvixEvent } from "./event.ts";
import type { PermissionMode } from "./permission.ts";
import type { JarvixProject } from "./project.ts";
import type { JarvixProviderContext } from "./provider-context.ts";
import type { ModelCatalog, ModelDefinition, ProviderModelSyncRequest } from "./providers.ts";
import type {
    JarvixSession,
    JarvixSessionContext,
    JarvixSessionSummary
} from "./session.ts";

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
    permissionSet: "jarvix:permission:set",
    permissionRespond: "jarvix:permission:respond",
    sessionRename: "jarvix:session:rename",
    sessionAutoName: "jarvix:session:auto-name",
    sessionArchive: "jarvix:session:archive",
    sessionUnarchive: "jarvix:session:unarchive",
    sessionDelete: "jarvix:session:delete",
    sessionOpen: "jarvix:session:open",
    sessionProviderContext: "jarvix:session:provider-context",
    sessionsList: "jarvix:sessions:list",
    sessionsListArchived: "jarvix:sessions:list-archived",
    sandboxStatus: "jarvix:sandbox:status",
    sandboxInstall: "jarvix:sandbox:install",
    sandboxDismiss: "jarvix:sandbox:dismiss",
    sandboxSetupRequired: "jarvix:sandbox:setup-required"
} as const;

export type JarvixEventBatch = {
    sessionId: string;
    events: JarvixEvent[];
};

export type SandboxStatus = {
    ready: boolean;
    warnings: string[];
};

export type SandboxInstallOutcome =
    | { status: "installed" }
    | { status: "cancelled" }
    | { status: "failed"; errors: string[] };

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
    createSession(context?: JarvixSessionContext, permission?: PermissionMode): Promise<JarvixSession>;
    updateSessionContext(
        sessionId: string,
        context: JarvixSessionContext
    ): Promise<JarvixSessionContext>;
    setPermission(
        sessionId: string,
        permission: PermissionMode
    ): Promise<PermissionMode>;
    respondPermission(
        sessionId: string,
        requestId: string,
        approved: boolean
    ): Promise<boolean>;
    renameSession(sessionId: string, name: string): Promise<string>;
    autoNameSession(sessionId: string, firstPrompt?: string): Promise<string>;
    archiveSession(sessionId: string): Promise<void>;
    unarchiveSession(sessionId: string): Promise<void>;
    deleteSession(sessionId: string): Promise<void>;
    openSession(sessionId: string): Promise<JarvixSession | null>;
    getProviderContext(sessionId: string): Promise<JarvixProviderContext>;
    listSessions(): Promise<JarvixSessionSummary[]>;
    listArchivedSessions(): Promise<JarvixSessionSummary[]>;
    getSandboxStatus(): Promise<SandboxStatus>;
    installSandbox(): Promise<SandboxInstallOutcome>;
    dismissSandboxSetup(): Promise<void>;
    onSandboxSetupRequired(listener: () => void): () => void;
};
