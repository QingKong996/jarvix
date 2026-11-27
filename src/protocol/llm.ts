import type { ReasoningLevel } from "./providers.ts";

/** Provider-neutral reasoning intensity. Adapters map it to the backend's own levels. */
export type LlmReasoningLevel = ReasoningLevel;

/** Why an assistant response ended. `pending` only appears on unfinished partial messages. */
export type LlmStopReason = "pending" | "stop" | "length" | "toolUse" | "error" | "aborted" | "deferred";

export type LlmJsonValue =
    | null
    | boolean
    | number
    | string
    | LlmJsonValue[]
    | { [key: string]: LlmJsonValue };

export type LlmJsonObject = { [key: string]: LlmJsonValue };

/** Identifies one model within the set exposed by an adapter. */
export type LlmModelRef = {
    provider: string;
    id: string;
};

/** Model metadata exposed to callers and UI. */
export type LlmModelInfo = LlmModelRef & {
    name: string;
    reasoning: boolean;
    contextWindow: number;
    maxTokens: number;
};

/** Token accounting for one response. `cost` is the total price in USD. */
export type LlmUsage = {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    reasoningTokens?: number;
    totalTokens: number;
    cost: number;
};

export type LlmTextBlock = {
    type: "text";
    text: string;
    /** Opaque provider signature kept so the block can be replayed in later turns. */
    signature?: string;
};

export type LlmThinkingBlock = {
    type: "thinking";
    thinking: string;
    signature?: string;
    redacted?: boolean;
};

/** Image payload accepted by pi-ai's tool result content. */
export type LlmImageContent = {
    type: "image";
    /** Base64-encoded image bytes without a data URL prefix. */
    data: string;
    mimeType: string;
};

export type LlmToolDefinition = {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
};

export type LlmToolReference = {
    name: string;
};

export type LlmToolCallBlock = {
    type: "toolCall";
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    signature?: string;
    argumentsError?: string;
};

export type LlmContentBlock = LlmTextBlock | LlmThinkingBlock | LlmToolCallBlock;
export type LlmToolResultContent = LlmTextBlock | LlmImageContent;

export type LlmUserMessage = {
    role: "user";
    content: string;
    timestamp: number;
    /** Internal marker for user-role context such as reminders or compacted history. */
    context?: "system-reminder" | "compact";
};

/**
 * Assistant message produced by an adapter. Keep it unchanged when it is sent back as
 * history: it carries the provider metadata needed to replay the turn.
 */
export type LlmAssistantMessage = {
    role: "assistant";
    content: LlmContentBlock[];
    provider: string;
    model: string;
    api: string;
    usage: LlmUsage;
    stopReason: LlmStopReason;
    timestamp: number;
    responseId?: string;
    responseModel?: string;
    errorMessage?: string;
};

/** A tool result is sent back to the model as its own message. */
export type LlmToolResultMessage = {
    role: "toolResult";
    toolCallId: string;
    toolName: string;
    /** Legacy text-only results stay readable; new results may also carry images. */
    content: string | LlmToolResultContent[];
    details?: LlmJsonObject;
    isError: boolean;
    timestamp: number;
};

export type LlmSystemNotice = {
    kind: "background.task_exit";
    sessionId: string;
    exitCode: number | null;
    errorMessage: string | null;
    unreadCharacters: number;
};

export type LlmSystemMessage = {
    role: "system";
    content: string;
    timestamp: number;
    notice?: LlmSystemNotice;
    /** Tool definitions that become available after this message. */
    toolsAdded?: LlmToolDefinition[];
    /** Tools that stop being available after this message. */
    toolsRemoved?: LlmToolReference[];
    /** Internal marker for injected system context. */
    context?: "environment" | "goal" | "agent-instructions" | "skills" | "skill";
    /** Fingerprint used to detect environment changes without rewriting the snapshot. */
    environmentKey?: string;
};

export type LlmMessage = LlmUserMessage | LlmAssistantMessage | LlmToolResultMessage | LlmSystemMessage;

/** One increment of a streamed response. `index` is the position of the content block. */
export type LlmStreamEvent =
    | { type: "start" }
    | { type: "text.start"; index: number }
    | { type: "text.delta"; index: number; delta: string }
    | { type: "text.end"; index: number; text: string }
    | { type: "thinking.start"; index: number }
    | { type: "thinking.delta"; index: number; delta: string }
    | { type: "thinking.end"; index: number; text: string }
    | { type: "toolCall.start"; index: number }
    | { type: "toolCall.delta"; index: number; delta: string }
    | { type: "toolCall.end"; index: number; toolCall: LlmToolCallBlock }
    | { type: "done"; message: LlmAssistantMessage }
    | { type: "error"; message: LlmAssistantMessage };

export function toolResultContentText(
    content: LlmToolResultMessage["content"]
): string {
    if (typeof content === "string") {
        return content;
    }
    return content
        .map((block) => block.type === "text" ? block.text : `[Image: ${block.mimeType}]`)
        .join("\n");
}
