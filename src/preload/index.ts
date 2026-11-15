import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type { JarvixBridge, JarvixEventBatch } from "../protocol/ipc.ts";
import { IPC_CHANNELS } from "../protocol/ipc.ts";

const bridge: JarvixBridge = {
    request: (question, sessionId) => ipcRenderer.invoke(IPC_CHANNELS.request, { question, sessionId }),
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
    createProject: (name, workingDirectories) => ipcRenderer.invoke(
        IPC_CHANNELS.projectCreate,
        { name, workingDirectories }
    ),
    listProjects: () => ipcRenderer.invoke(IPC_CHANNELS.projectsList),
    pickWorkingDirectories: () => ipcRenderer.invoke(IPC_CHANNELS.pickWorkingDirectories),
    pickWorkingDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.pickWorkingDirectory),
    createSession: (context = {}) => ipcRenderer.invoke(IPC_CHANNELS.sessionCreate, { context }),
    updateSessionContext: (sessionId, context) => ipcRenderer.invoke(
        IPC_CHANNELS.sessionUpdateContext,
        { sessionId, context }
    ),
    renameSession: (sessionId, name) => ipcRenderer.invoke(
        IPC_CHANNELS.sessionRename,
        { sessionId, name }
    ),
    autoNameSession: (sessionId, firstPrompt) => ipcRenderer.invoke(
        IPC_CHANNELS.sessionAutoName,
        { sessionId, firstPrompt }
    ),
    openSession: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.sessionOpen, sessionId),
    listSessions: () => ipcRenderer.invoke(IPC_CHANNELS.sessionsList)
};

contextBridge.exposeInMainWorld("jarvix", bridge);
