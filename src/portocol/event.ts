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
    contentIndex: number
    delta: string
} | {
    type: "text.start"
    contentIndex: number
} | {
    type: "text.end"
    contentIndex: number
} | {
    type: "thinking.delta"
    contentIndex: number
    delta: string
} | {
    type: "thinking.start"
    contentIndex: number
} | {
    type: "thinking.end"
    contentIndex: number
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



