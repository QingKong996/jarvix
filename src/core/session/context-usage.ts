import type {
    LlmContentBlock,
    LlmMessage,
    LlmToolDefinition
} from "../../llm/types.ts";
import type { JarvixContextUsage } from "../../protocol/context-usage.ts";

const MESSAGE_OVERHEAD_TOKENS = 4;
const CONTENT_BLOCK_OVERHEAD_TOKENS = 2;
const TOOL_OVERHEAD_TOKENS = 8;
const CONTEXT_OMISSION_NOTICE = [
    "<system-reminder>",
    "Earlier conversation history was omitted to fit the model context window.",
    "</system-reminder>"
].join("\n");

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

export type FittedContext = {
    messages: LlmMessage[];
    estimatedTokens: number;
    omittedMessages: number;
    fits: boolean;
};

/**
 * Keep the newest user turn and remove older complete turns when the prompt
 * exceeds the model's input budget. A user-message boundary is used so tool
 * calls and tool results cannot be split into an invalid provider sequence.
 */
export function fitMessagesToContext(
    input: ContextUsageInput & { maxOutputTokens?: number }
): FittedContext {
    const full = [...input.messages];
    const budget = inputBudget(input);
    const fullEstimate = estimate(input, full);
    if (fullEstimate <= budget) {
        return {
            messages: full,
            estimatedTokens: fullEstimate,
            omittedMessages: 0,
            fits: true
        };
    }

    const latestUser = findPreviousPrompt(full, full.length);
    if (latestUser === -1) {
        return {
            messages: full,
            estimatedTokens: fullEstimate,
            omittedMessages: 0,
            fits: false
        };
    }

    const environmentIndex = full.findIndex((message) => (
        message.role === "system" && message.context === "environment"
    ));
    let start = latestUser;
    while (start >= 0) {
        const messages = candidateMessages(full, environmentIndex, start);
        const estimatedTokens = estimate(input, messages);
        const omittedMessages = full
            .slice(0, start)
            .filter((_, index) => index !== environmentIndex)
            .length;
        if (estimatedTokens <= budget) {
            return {
                messages,
                estimatedTokens,
                omittedMessages,
                fits: true
            };
        }

        const previous = findPreviousPrompt(full, start);
        if (previous === -1 || previous === start) {
            break;
        }
        start = previous;
    }

    const messages = candidateMessages(full, environmentIndex, latestUser);
    const omittedMessages = full
        .slice(0, latestUser)
        .filter((_, index) => index !== environmentIndex)
        .length;
    return {
        messages,
        estimatedTokens: estimate(input, messages),
        omittedMessages,
        fits: false
    };
}

function candidateMessages(
    messages: readonly LlmMessage[],
    environmentIndex: number,
    start: number
): LlmMessage[] {
    const environment = environmentIndex >= 0 ? messages[environmentIndex] : undefined;
    const omitted = messages
        .slice(0, start)
        .some((_, index) => index !== environmentIndex);
    return [
        ...(environment ? [environment] : []),
        ...(omitted ? [{
            role: "user" as const,
            content: CONTEXT_OMISSION_NOTICE,
            context: "system-reminder" as const,
            timestamp: Date.now()
        }] : []),
        ...messages.slice(start)
    ];
}

function findPreviousPrompt(messages: readonly LlmMessage[], before: number): number {
    for (let index = before - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message?.role === "user" && message.context !== "system-reminder") {
            return index;
        }
    }
    return -1;
}

function inputBudget(input: ContextUsageInput & { maxOutputTokens?: number }): number {
    const reserve = Math.max(
        0,
        Math.min(
            input.maxOutputTokens ?? 0,
            Math.max(0, input.contextWindow - 1)
        )
    );
    return Math.max(1, Math.floor(input.contextWindow) - reserve);
}

function estimate(
    input: ContextUsageInput,
    messages: readonly LlmMessage[]
): number {
    return estimateContextUsage({
        contextWindow: input.contextWindow,
        messages,
        systemPrompt: input.systemPrompt,
        tools: input.tools
    }).estimatedTokens;
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
