import type { JarvixBridge } from "../../protocol/ipc.ts";

declare global {
    interface Window {
        jarvix: JarvixBridge;
    }
}

export {};
