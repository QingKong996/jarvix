import type {
    LlmContentBlock,
    LlmMessage,
    LlmToolDefinition
} from "../../llm/types.ts";
import type { JarvixContextUsage } from "../../protocol/context-usage.ts";

const MESSAGE_OVERHEAD_TOKENS = 4;
const CONTENT_BLOCK_OVERHEAD_TOKENS = 2;
const TOOL_OVERHEAD_TOKENS = 8;

export type ContextUsageInput = {
    contextWindow: number;
    messages: readonly LlmMessage[];
    systemPrompt?: string;
    tools?: readonly LlmToolDefinition[];
};

/** Estimate the prompt footprint without provider-specific tokenizers. */
export function estimateContextUsage(input: ContextUsageInput): JarvixContextUsage {
    let estimatedTokens = 3;
    if (input.systemPrompt) {
        estimatedTokens += MESSAGE_OVERHEAD_TOKENS + estimateTextTokens(input.systemPrompt);
    }
    for (const message of input.messages) {
        estimatedTokens += estimateMessageTokens(message);
    }
    for (const tool of input.tools ?? []) {
        estimatedTokens += estimateToolTokens(tool);
    }
    return {
        estimatedTokens,
        contextWindow: Math.max(1, Math.floor(input.contextWindow))
    };
}

function estimateMessageTokens(message: LlmMessage): number {
    switch (message.role) {
        case "user":
            return MESSAGE_OVERHEAD_TOKENS + estimateTextTokens(message.content);
        case "system":
            return MESSAGE_OVERHEAD_TOKENS + estimateTextTokens(message.content);
        case "toolResult":
            return MESSAGE_OVERHEAD_TOKENS
                + estimateTextTokens(message.toolName)
                + estimateTextTokens(message.content)
                + estimateJsonTokens(message.details);
        case "assistant":
            return MESSAGE_OVERHEAD_TOKENS + message.content.reduce(
                (total, block) => total + estimateBlockTokens(block),
                0
            );
    }
}

function estimateBlockTokens(block: LlmContentBlock): number {
    switch (block.type) {
        case "text":
            return CONTENT_BLOCK_OVERHEAD_TOKENS + estimateTextTokens(block.text);
        case "thinking":
            return CONTENT_BLOCK_OVERHEAD_TOKENS + estimateTextTokens(block.thinking);
        case "toolCall":
            return CONTENT_BLOCK_OVERHEAD_TOKENS
                + estimateTextTokens(block.name)
                + estimateJsonTokens(block.arguments);
    }
}

function estimateToolTokens(tool: LlmToolDefinition): number {
    return TOOL_OVERHEAD_TOKENS
        + estimateTextTokens(tool.name)
        + estimateTextTokens(tool.description)
        + estimateJsonTokens(tool.parameters);
}

function estimateJsonTokens(value: unknown): number {
    return value === undefined ? 0 : estimateTextTokens(JSON.stringify(value));
}

function estimateTextTokens(text: string): number {
    let asciiCharacters = 0;
    let otherCharacters = 0;
    for (const character of text) {
        if (character.codePointAt(0)! <= 0x7f) {
            asciiCharacters += 1;
        } else {
            otherCharacters += 1;
        }
    }
    return Math.ceil(asciiCharacters / 4 + otherCharacters / 1.5);
}
