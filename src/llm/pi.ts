import type {
    Api,
    AssistantMessage,
    AssistantMessageEvent,
    Context,
    JsonObject,
    Message,
    Model,
    Models,
    TextContent,
    ThinkingContent,
    ToolCall,
    Usage
} from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { ProviderConfig } from "../protocol/providers.ts";
import { configuredModels } from "./providers.ts";
import type { LlmAdapter, LlmRequest } from "./adapter.ts";
import type {
    LlmAssistantMessage,
    LlmContentBlock,
    LlmMessage,
    LlmModelInfo,
    LlmStreamEvent,
    LlmToolCallBlock,
    LlmUsage
} from "./types.ts";

export type PiAdapterOptions = {
    /** Model collection to talk to. Defaults to every built-in pi provider. */
    models?: Models;
    providers?: () => readonly ProviderConfig[] | undefined;
};

/** Exposes pi-ai through the unified [`LlmAdapter`] contract. */
export function createPiAdapter(options: PiAdapterOptions = {}): LlmAdapter {
    const models = options.models ?? builtinModels();
    let previous: readonly ProviderConfig[] | undefined;
    let configured: Models | undefined;
    function collection(provider: string): Models {
        const providers = options.providers?.();
        if (providers !== previous) {
            configured = providers ? configuredModels(providers) : undefined;
            previous = providers;
        }
        return providers?.some((item) => item.id === provider) ? configured! : models;
    }

    return {
        getModel(provider, id) {
            const model = collection(provider).getModel(provider, id);
            return model ? toModelInfo(model) : undefined;
        },

        stream(request) {
            const activeModels = collection(request.model.provider);
            const model = activeModels.getModel(request.model.provider, request.model.id);
            if (!model) {
                throw new Error(`Unknown model: ${request.model.provider}/${request.model.id}`);
            }

            return toLlmStream(
                activeModels.streamSimple(model, toPiContext(request), {
                    apiKey: request.apiKey,
                    // pi-ai's simple contract has no explicit "none" effort.
                    reasoning: request.reasoning === "none" ? undefined : request.reasoning,
                    temperature: request.temperature,
                    maxTokens: request.maxTokens,
                    signal: request.signal
                })
            );
        }
    };
}

function toModelInfo(model: Model<Api>): LlmModelInfo {
    return {
        provider: model.provider,
        id: model.id,
        name: model.name,
        reasoning: model.reasoning,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens
    };
}

function toPiContext(request: LlmRequest): Context {
    return {
        systemPrompt: request.systemPrompt,
        messages: request.messages.map(toPiMessage)
    };
}

function toPiMessage(message: LlmMessage): Message {
    if (message.role === "user") {
        return {
            role: "user",
            content: message.content,
            timestamp: message.timestamp
        };
    }

    return {
        role: "assistant",
        content: message.content.map(toPiContentBlock),
        api: message.api,
        provider: message.provider,
        model: message.model,
        usage: toPiUsage(message.usage),
        stopReason: message.stopReason,
        timestamp: message.timestamp,
        responseId: message.responseId,
        responseModel: message.responseModel,
        errorMessage: message.errorMessage
    };
}

function toPiContentBlock(block: LlmContentBlock): TextContent | ThinkingContent | ToolCall {
    switch (block.type) {
        case "text":
            return { type: "text", text: block.text, textSignature: block.signature };
        case "thinking":
            return {
                type: "thinking",
                thinking: block.thinking,
                thinkingSignature: block.signature,
                redacted: block.redacted
            };
        case "toolCall":
            return {
                type: "toolCall",
                id: block.id,
                name: block.name,
                arguments: block.arguments as JsonObject,
                thoughtSignature: block.signature
            };
    }
}

function toPiUsage(usage: LlmUsage): Usage {
    return {
        input: usage.inputTokens,
        output: usage.outputTokens,
        cacheRead: usage.cacheReadTokens,
        cacheWrite: usage.cacheWriteTokens,
        reasoning: usage.reasoningTokens,
        totalTokens: usage.totalTokens,
        cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: usage.cost
        }
    };
}

function toLlmAssistantMessage(message: AssistantMessage): LlmAssistantMessage {
    return {
        role: "assistant",
        content: message.content.map(toLlmContentBlock),
        provider: message.provider,
        model: message.model,
        api: message.api,
        usage: toLlmUsage(message.usage),
        stopReason: message.stopReason,
        timestamp: message.timestamp,
        responseId: message.responseId,
        responseModel: message.responseModel,
        errorMessage: message.errorMessage
    };
}

function toLlmContentBlock(block: TextContent | ThinkingContent | ToolCall): LlmContentBlock {
    switch (block.type) {
        case "text":
            return { type: "text", text: block.text, signature: block.textSignature };
        case "thinking":
            return {
                type: "thinking",
                thinking: block.thinking,
                signature: block.thinkingSignature,
                redacted: block.redacted
            };
        case "toolCall":
            return {
                type: "toolCall",
                id: block.id,
                name: block.name,
                arguments: block.arguments,
                signature: block.thoughtSignature
            };
    }
}

function toLlmToolCall(toolCall: ToolCall): LlmToolCallBlock {
    return {
        type: "toolCall",
        id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.arguments,
        signature: toolCall.thoughtSignature
    };
}

function toLlmUsage(usage: Usage): LlmUsage {
    return {
        inputTokens: usage.input,
        outputTokens: usage.output,
        cacheReadTokens: usage.cacheRead,
        cacheWriteTokens: usage.cacheWrite,
        reasoningTokens: usage.reasoning,
        totalTokens: usage.totalTokens,
        cost: usage.cost.total
    };
}

async function* toLlmStream(stream: AsyncIterable<AssistantMessageEvent>): AsyncIterable<LlmStreamEvent> {
    for await (const event of stream) {
        yield toLlmStreamEvent(event);
    }
}

function toLlmStreamEvent(event: AssistantMessageEvent): LlmStreamEvent {
    switch (event.type) {
        case "start":
            return { type: "start" };
        case "text_start":
            return { type: "text.start", index: event.contentIndex };
        case "text_delta":
            return { type: "text.delta", index: event.contentIndex, delta: event.delta };
        case "text_end":
            return { type: "text.end", index: event.contentIndex, text: event.content };
        case "thinking_start":
            return { type: "thinking.start", index: event.contentIndex };
        case "thinking_delta":
            return { type: "thinking.delta", index: event.contentIndex, delta: event.delta };
        case "thinking_end":
            return { type: "thinking.end", index: event.contentIndex, text: event.content };
        case "toolcall_start":
            return { type: "toolCall.start", index: event.contentIndex };
        case "toolcall_delta":
            return { type: "toolCall.delta", index: event.contentIndex, delta: event.delta };
        case "toolcall_end":
            return { type: "toolCall.end", index: event.contentIndex, toolCall: toLlmToolCall(event.toolCall) };
        case "done":
            return { type: "done", message: toLlmAssistantMessage(event.message) };
        case "error":
            return { type: "error", message: toLlmAssistantMessage(event.error) };
    }
}
