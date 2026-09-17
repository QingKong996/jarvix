import type { AssistantMessage } from "@earendil-works/pi-ai";

export const LOG_LEVELS = ["log", "info", "warn", "error", "debug"] as const;
export type LogLevel = typeof LOG_LEVELS[number];




export type JarvixEvent = 
  | {
    type: "log"
    level: LogLevel
    text: string
} | {
    type: "text.delta"
    delta: string
} | {
    type: "text.start"
} | {
    type: "text.end"
} | {
    type: "thinking.delta"
    delta: string
} | {
    type: "thinking.start"
} | {
    type: "thinking.end"
} | {
    type: "error"
    error: string | undefined
} | {
    type: "done"
    reason: string
    message: AssistantMessage
} | {
    type: "start"
}

export type JarvixListener = (jatvixEvent: JarvixEvent) => void;



