import type { LlmStreamEvent, LlmSystemMessage } from "../llm/types.ts";
import type { ToolCallEndReason, ToolTaskEvent } from "../core/tools/types.ts";
import type { ToolCallOutputDelta, ToolCallViewData } from "../core/tools/view.ts";
import type { JarvixContextUsage } from "./context-usage.ts";
import type {
    PermissionDecision,
    PermissionRequest
} from "./permission.ts";
export const LOG_LEVELS = ["log", "info", "warn", "error", "debug"] as const;
export type LogLevel = typeof LOG_LEVELS[number];

export type JarvixToolEvent =
  | {
    type: "tool.start";
    toolCallId: string;
    toolName: string;
    data: ToolCallViewData;
  } | {
    type: "tool.output";
    toolCallId: string;
    toolName: string;
    data: ToolCallOutputDelta;
  } | {
    type: "tool.end";
    toolCallId: string;
    toolName: string;
    data: ToolCallViewData;
    isError: boolean;
    endReason: ToolCallEndReason;
  };

export type JarvixEvent = LlmStreamEvent
  | JarvixToolEvent
  | ToolTaskEvent
  | {
    type: "system.message";
    message: LlmSystemMessage;
  }
  | {
    type: "log";
    level: LogLevel;
    text: string;
  } | {
    type: "request.error";
    error: string;
  } | {
    type: "session.renamed";
    name: string;
  } | {
    type: "prompt.injected";
    promptId: string;
    text: string;
  } | {
    type: "context.usage";
    usage: JarvixContextUsage;
  } | {
    type: "permission.request";
    request: PermissionRequest;
  } | {
    type: "permission.resolved";
    requestId: string;
    decision: PermissionDecision;
  };

export type JarvixListener = (jarvixEvent: JarvixEvent, sessionId: string) => void;

export function isFunctionCallResultEvent(
    event: JarvixEvent
): event is Extract<JarvixEvent, { type: "tool.end" }> {
    return event.type === "tool.end";
}
