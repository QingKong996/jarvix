import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type { JarvixBridge } from "../protocol/ipc.ts";
import { IPC_CHANNELS } from "../protocol/ipc.ts";
import type { JarvixEvent } from "../protocol/event.ts";

const bridge: JarvixBridge = {
    request: (question) => ipcRenderer.invoke(IPC_CHANNELS.request, question),
    onEvents: (listener) => {
        const handler = (_event: IpcRendererEvent, events: JarvixEvent[]): void => {
            listener(events);
        };
        ipcRenderer.on(IPC_CHANNELS.event, handler);
        return () => {
            ipcRenderer.removeListener(IPC_CHANNELS.event, handler);
        };
    },
    getConfig: () => ipcRenderer.invoke(IPC_CHANNELS.configGet),
    setConfig: (config) => ipcRenderer.invoke(IPC_CHANNELS.configSet, config)
};

contextBridge.exposeInMainWorld("jarvix", bridge);
