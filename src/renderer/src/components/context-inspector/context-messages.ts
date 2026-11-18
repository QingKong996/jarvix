import type {
    LlmContentBlock,
    LlmMessage
} from "../../../../llm/types.ts";
import type { JarvixProviderContext } from "../../../../protocol/provider-context.ts";

export type ContextMessageEntry = {
    role: LlmMessage["role"];
    text: string;
    preview: string;
};

export function contextMessagesFor(context: JarvixProviderContext): ContextMessageEntry[] {
    const systemPrompt = context.systemPrompt
        ? [{
            role: "system" as const,
            text: context.systemPrompt,
            preview: previewText(context.systemPrompt)
        }]
        : [];

    return [
        ...systemPrompt,
        ...context.messages.map((message) => ({
            role: message.role,
            text: messageText(message),
            preview: messagePreview(message)
        }))
    ];
}

function messageText(message: LlmMessage): string {
    if (message.role !== "assistant") {
        return message.content;
    }
    return message.content.map(blockText).filter(Boolean).join("\n\n");
}

function blockText(block: LlmContentBlock): string {
    if (block.type === "text") {
        return block.text;
    }
    if (block.type === "thinking") {
        return block.thinking;
    }
    return [
        block.name,
        JSON.stringify(block.arguments, null, 2)
    ].join("\n");
}

function messagePreview(message: LlmMessage): string {
    if (message.role === "toolResult") {
        return detailPreview(message.toolName, message.content);
    }
    if (message.role !== "assistant") {
        return previewText(message.content);
    }

    const toolCall = message.content.find((block) => block.type === "toolCall");
    if (toolCall) {
        return detailPreview(
            toolCall.name,
            JSON.stringify(toolCall.arguments)
        );
    }
    const text = message.content.find(
        (block) => block.type === "text" && block.text.trim().length > 0
    );
    if (text?.type === "text") {
        return previewText(text.text);
    }
    const thinking = message.content.find(
        (block) => block.type === "thinking" && block.thinking.trim().length > 0
    );
    return thinking?.type === "thinking"
        ? previewText(thinking.thinking)
        : "";
}

function detailPreview(name: string, value: string): string {
    const title = name.trim();
    const detail = previewText(value);
    if (title && detail) {
        return `${title} · ${detail}`;
    }
    return title || detail;
}

function previewText(value: string, limit = 120): string {
    const text = value.replace(/\s+/g, " ").trim();
    return text.length > limit
        ? `${text.slice(0, limit).trimEnd()}…`
        : text;
}
