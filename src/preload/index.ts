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
    setConfig: (config) => ipcRenderer.invoke(IPC_CHANNELS.configSet, config),
    createSession: () => ipcRenderer.invoke(IPC_CHANNELS.sessionCreate),
    openSession: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.sessionOpen, sessionId),
    listSessions: () => ipcRenderer.invoke(IPC_CHANNELS.sessionsList)
};

contextBridge.exposeInMainWorld("jarvix", bridge);
