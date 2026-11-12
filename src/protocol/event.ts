import type { LlmStreamEvent } from "../llm/types.ts";

export const LOG_LEVELS = ["log", "info", "warn", "error", "debug"] as const;
export type LogLevel = typeof LOG_LEVELS[number];

export type JarvixEvent = LlmStreamEvent
  | {
    type: "log";
    level: LogLevel;
    text: string;
  } | {
    type: "request.error";
    error: string;
  };

export type JarvixListener = (jarvixEvent: JarvixEvent, sessionId: string) => void;
