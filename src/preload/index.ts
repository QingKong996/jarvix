import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { IpcRendererEvent } from "electron";
import type { JarvixBridge, JarvixEventBatch } from "../protocol/ipc.ts";
import { IPC_CHANNELS } from "../protocol/ipc.ts";

const bridge: JarvixBridge = {
    request: (question, sessionId, sandboxPaths) => ipcRenderer.invoke(
        IPC_CHANNELS.request,
        { question, sessionId, sandboxPaths }
    ),
    injectPrompt: (question, sessionId, promptId, sandboxPaths) => ipcRenderer.invoke(
        IPC_CHANNELS.requestInject,
        { question, sessionId, promptId, sandboxPaths }
    ),
    stopRequest: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.requestStop, sessionId),
    completePaths: (query, context) => ipcRenderer.invoke(
        IPC_CHANNELS.pathsComplete,
        { query, context }
    ),
    pathForFile: (file) => webUtils.getPathForFile(
        file as Parameters<typeof webUtils.getPathForFile>[0]
    ),
    resolvePaths: (paths, context) => ipcRenderer.invoke(
        IPC_CHANNELS.pathsResolve,
        { paths, context }
    ),
    onEvents: (listener) => {
        const handler = (_event: IpcRendererEvent, batch: JarvixEventBatch): void => {
            listener(batch);
        };
        ipcRenderer.on(IPC_CHANNELS.event, handler);
        return () => {
            ipcRenderer.removeListener(IPC_CHANNELS.event, handler);
        };
    },
    getConfig: () => ipcRenderer.invoke(IPC_CHANNELS.configGet),
    getModelCatalog: (force = false) => ipcRenderer.invoke(IPC_CHANNELS.catalogGet, force),
    syncProviderModels: (provider) => ipcRenderer.invoke(IPC_CHANNELS.providerModelsSync, provider),
    setConfig: (config) => ipcRenderer.invoke(IPC_CHANNELS.configSet, config),
    listSkills: (workingDirectories, scope = "all") => ipcRenderer.invoke(
        IPC_CHANNELS.skillsList,
        workingDirectories,
        scope
    ),
    loadSkill: (sessionId, name) => ipcRenderer.invoke(
        IPC_CHANNELS.skillLoad,
        { sessionId, name }
    ),
    createProject: (name, workingDirectories) => ipcRenderer.invoke(
        IPC_CHANNELS.projectCreate,
        { name, workingDirectories }
    ),
    listProjects: () => ipcRenderer.invoke(IPC_CHANNELS.projectsList),
    pickWorkingDirectories: () => ipcRenderer.invoke(IPC_CHANNELS.pickWorkingDirectories),
    pickWorkingDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.pickWorkingDirectory),
    createSession: (context = {}, permission) => ipcRenderer.invoke(
        IPC_CHANNELS.sessionCreate,
        { context, permission }
    ),
    updateSessionContext: (sessionId, context) => ipcRenderer.invoke(
        IPC_CHANNELS.sessionUpdateContext,
        { sessionId, context }
    ),
    setPermission: (sessionId, permission) => ipcRenderer.invoke(
        IPC_CHANNELS.permissionSet,
        { sessionId, permission }
    ),
    respondPermission: (sessionId, requestId, approved) => ipcRenderer.invoke(
        IPC_CHANNELS.permissionRespond,
        { sessionId, requestId, approved }
    ),
    renameSession: (sessionId, name) => ipcRenderer.invoke(
        IPC_CHANNELS.sessionRename,
        { sessionId, name }
    ),
    autoNameSession: (sessionId, firstPrompt) => ipcRenderer.invoke(
        IPC_CHANNELS.sessionAutoName,
        { sessionId, firstPrompt }
    ),
    archiveSession: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.sessionArchive, sessionId),
    unarchiveSession: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.sessionUnarchive, sessionId),
    deleteSession: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.sessionDelete, sessionId),
    setGoal: (sessionId, content) => ipcRenderer.invoke(
        IPC_CHANNELS.sessionGoalSet,
        { sessionId, content }
    ),
    clearGoal: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.sessionGoalClear, sessionId),
    openSession: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.sessionOpen, sessionId),
    releaseSession: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.sessionRelease, sessionId),
    getProviderContext: (sessionId) => ipcRenderer.invoke(
        IPC_CHANNELS.sessionProviderContext,
        sessionId
    ),
    listSessions: () => ipcRenderer.invoke(IPC_CHANNELS.sessionsList),
    listArchivedSessions: () => ipcRenderer.invoke(IPC_CHANNELS.sessionsListArchived),
    getSandboxStatus: () => ipcRenderer.invoke(IPC_CHANNELS.sandboxStatus),
    installSandbox: () => ipcRenderer.invoke(IPC_CHANNELS.sandboxInstall),
    dismissSandboxSetup: () => ipcRenderer.invoke(IPC_CHANNELS.sandboxDismiss),
    onSandboxSetupRequired: (listener) => {
        const handler = (): void => {
            listener();
        };
        ipcRenderer.on(IPC_CHANNELS.sandboxSetupRequired, handler);
        return () => {
            ipcRenderer.removeListener(IPC_CHANNELS.sandboxSetupRequired, handler);
        };
    }
};

contextBridge.exposeInMainWorld("jarvix", bridge);
