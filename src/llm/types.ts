/** Provider-neutral reasoning intensity. Adapters map it to the backend's own levels. */
export type LlmReasoningLevel = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** Why an assistant response ended. `pending` only appears on unfinished partial messages. */
export type LlmStopReason = "pending" | "stop" | "length" | "toolUse" | "error" | "aborted" | "deferred";

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

export type LlmToolCallBlock = {
    type: "toolCall";
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    signature?: string;
};

export type LlmContentBlock = LlmTextBlock | LlmThinkingBlock | LlmToolCallBlock;

export type LlmUserMessage = {
    role: "user";
    content: string;
    timestamp: number;
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

export type LlmMessage = LlmUserMessage | LlmAssistantMessage;

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
