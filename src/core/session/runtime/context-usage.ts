import type {
    LlmContentBlock,
    LlmMessage,
    LlmToolDefinition,
    LlmToolResultContent,
    LlmUsage
} from "../../../protocol/llm.ts";
import type { JarvixContextUsage } from "../../../protocol/context-usage.ts";

const CHARS_PER_TOKEN = 3.5;
const ESTIMATED_IMAGE_CHARS = 4800;
// Session history is append-only, so each message's estimate can be reused.
const messageTokenCache = new WeakMap<LlmMessage, number>();

export type ContextUsageInput = {
    contextWindow: number;
    messages: readonly LlmMessage[];
    systemPrompt?: string;
    tools?: readonly LlmToolDefinition[];
};

type UsageInfo = {
    index: number;
    usage: LlmUsage;
};

/** Estimate the prompt from the latest provider usage plus any trailing messages. */
export function estimateContextUsage(input: ContextUsageInput): JarvixContextUsage {
    const usageInfo = latestAssistantUsage(input.messages);
    const estimatedTokens = usageInfo
        ? reportedContextTokens(usageInfo.usage)
            + estimateMessages(input.messages.slice(usageInfo.index + 1))
        : estimateFixedTokens(input) + estimateMessages(input.messages);
    return {
        estimatedTokens,
        contextWindow: Math.max(1, Math.floor(input.contextWindow))
    };
}

function estimateFixedTokens(input: Pick<ContextUsageInput, "systemPrompt" | "tools">): number {
    const systemPromptTokens = input.systemPrompt
        ? estimateTextTokens(input.systemPrompt)
        : 0;
    const toolTokens = input.tools && input.tools.length > 0
        ? estimateTextTokens(safeJsonStringify(input.tools))
        : 0;
    return systemPromptTokens + toolTokens;
}

function estimateMessages(messages: readonly LlmMessage[]): number {
    let tokens = 0;
    for (const message of messages) {
        tokens += estimateMessageTokens(message);
    }
    return tokens;
}

function estimateMessageTokens(message: LlmMessage): number {
    const cached = messageTokenCache.get(message);
    if (cached !== undefined) {
        return cached;
    }
    const tokens = estimateMessageTokensUncached(message);
    messageTokenCache.set(message, tokens);
    return tokens;
}

function estimateMessageTokensUncached(message: LlmMessage): number {
    switch (message.role) {
        case "user":
            return estimateTextTokens(message.content);
        case "system":
            return estimateTextTokens(message.content);
        case "toolResult":
            return estimateToolResultContentTokens(message.content);
        case "assistant":
            return estimateAssistantContentTokens(message.content);
    }
}

function estimateToolResultContentTokens(
    content: string | LlmToolResultContent[]
): number {
    if (typeof content === "string") {
        return estimateTextTokens(content);
    }
    let characters = 0;
    for (const block of content) {
        characters += block.type === "text"
            ? block.text.length
            : ESTIMATED_IMAGE_CHARS;
    }
    return Math.ceil(characters / CHARS_PER_TOKEN);
}

function estimateAssistantContentTokens(blocks: readonly LlmContentBlock[]): number {
    let characters = 0;
    for (const block of blocks) {
        characters += estimateBlockCharacters(block);
    }
    return Math.ceil(characters / CHARS_PER_TOKEN);
}

function estimateBlockCharacters(block: LlmContentBlock): number {
    switch (block.type) {
        case "text":
            return block.text.length;
        case "thinking":
            return block.thinking.length;
        case "toolCall":
            return block.name.length + safeJsonStringify(block.arguments).length;
    }
}

function latestAssistantUsage(messages: readonly LlmMessage[]): UsageInfo | null {
    let usageInfo: UsageInfo | null = null;
    let latestPrefixTimestamp = Number.NEGATIVE_INFINITY;
    for (const [index, message] of messages.entries()) {
        if (message.role === "assistant") {
            const appliesToPrefix = message.timestamp >= latestPrefixTimestamp;
            const usageTokens = reportedContextTokens(message.usage);
            if (
                appliesToPrefix
                && message.stopReason !== "aborted"
                && message.stopReason !== "error"
                && usageTokens > 0
            ) {
                usageInfo = { index, usage: message.usage };
            }
        }
        latestPrefixTimestamp = Math.max(latestPrefixTimestamp, message.timestamp);
    }
    return usageInfo;
}

function reportedContextTokens(usage: LlmUsage): number {
    return usage.totalTokens
        || usage.inputTokens
            + usage.outputTokens
            + usage.cacheReadTokens
            + usage.cacheWriteTokens;
}

function estimateTextTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function safeJsonStringify(value: unknown): string {
    try {
        return JSON.stringify(value) ?? "undefined";
    } catch {
        return "[unserializable]";
    }
}
