import type { JarvixConfig } from "./config.ts";
import type { JarvixEvent } from "./event.ts";

export const IPC_CHANNELS = {
    request: "jarvix:request",
    event: "jarvix:event",
    configGet: "jarvix:config:get",
    configSet: "jarvix:config:set"
} as const;

export type JarvixBridge = {
    request(question: string): Promise<void>;
    onEvents(listener: (events: JarvixEvent[]) => void): () => void;
    getConfig(): Promise<JarvixConfig>;
    setConfig(config: JarvixConfig): Promise<JarvixConfig>;
};
