
export const LOG_LEVELS = ["log", "info", "warn", "error", "debug"] as const;
export type LogLevel = typeof LOG_LEVELS[number];

/** Final assistant content block. `index` is the block position reported by the LLM adapter. */
export type AssistantBlock =
  | {
    type: "text";
    index: number;
    text: string;
  } | {
    type: "thinking";
    index: number;
    thinking: string;
  };

export type JarvixEvent =
  | {
    type: "log";
    level: LogLevel;
    text: string;
  } | {
    type: "text.delta";
    contentIndex: number;
    delta: string;
  } | {
    type: "text.start";
    contentIndex: number;
  } | {
    type: "text.end";
    contentIndex: number;
  } | {
    type: "thinking.delta";
    contentIndex: number;
    delta: string;
  } | {
    type: "thinking.start";
    contentIndex: number;
  } | {
    type: "thinking.end";
    contentIndex: number;
  } | {
    type: "error";
    error: string | undefined;
  } | {
    type: "done";
    reason: string;
    blocks: AssistantBlock[];
  } | {
    type: "start";
  };

export type JarvixListener = (jarvixEvent: JarvixEvent) => void;
