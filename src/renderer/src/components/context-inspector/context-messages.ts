import type {
    LlmContentBlock,
    LlmMessage,
    LlmToolCallBlock
} from "../../../../llm/types.ts";
import type { JarvixProviderContext } from "../../../../protocol/provider-context.ts";

export type ContextMessageKind =
    | "system"
    | "user"
    | "assistant"
    | "toolCall"
    | "toolResult";

export type ContextMessageEntry = {
    kind: ContextMessageKind;
    text: string;
    preview: string;
};

export function contextMessagesFor(context: JarvixProviderContext): ContextMessageEntry[] {
    const systemPrompt = context.systemPrompt
        ? [{
            kind: "system" as const,
            text: context.systemPrompt,
            preview: previewText(context.systemPrompt)
        }]
        : [];

    return [
        ...systemPrompt,
        ...context.messages.flatMap(messageEntries)
    ];
}

function messageEntries(message: LlmMessage): ContextMessageEntry[] {
    if (message.role === "system" || message.role === "user") {
        return [{
            kind: message.role,
            text: message.content,
            preview: previewText(message.content)
        }];
    }
    if (message.role === "toolResult") {
        return [{
            kind: "toolResult",
            text: message.content,
            preview: detailPreview(message.toolName, message.content)
        }];
    }
    return assistantEntries(message.content);
}

function assistantEntries(blocks: readonly LlmContentBlock[]): ContextMessageEntry[] {
    const entries: ContextMessageEntry[] = [];
    let assistantBlocks: LlmContentBlock[] = [];

    const flushAssistantBlocks = (): void => {
        if (assistantBlocks.length === 0) {
            return;
        }
        entries.push({
            kind: "assistant",
            text: assistantBlocks.map(assistantBlockText).filter(Boolean).join("\n\n"),
            preview: assistantPreview(assistantBlocks)
        });
        assistantBlocks = [];
    };

    for (const block of blocks) {
        if (block.type === "toolCall") {
            flushAssistantBlocks();
            entries.push(toolCallEntry(block));
        } else {
            assistantBlocks.push(block);
        }
    }
    flushAssistantBlocks();
    return entries;
}

function assistantBlockText(block: LlmContentBlock): string {
    if (block.type === "text") {
        return block.text;
    }
    if (block.type === "thinking") {
        return block.thinking;
    }
    return "";
}

function assistantPreview(blocks: readonly LlmContentBlock[]): string {
    const text = blocks.find(
        (block) => block.type === "text" && block.text.trim().length > 0
    );
    if (text?.type === "text") {
        return previewText(text.text);
    }
    const thinking = blocks.find(
        (block) => block.type === "thinking" && block.thinking.trim().length > 0
    );
    return thinking?.type === "thinking"
        ? previewText(thinking.thinking)
        : "";
}

function toolCallEntry(toolCall: LlmToolCallBlock): ContextMessageEntry {
    const argumentsText = JSON.stringify(toolCall.arguments, null, 2);
    return {
        kind: "toolCall",
        text: [
            toolCall.name,
            argumentsText
        ].join("\n"),
        preview: detailPreview(
            toolCall.name,
            JSON.stringify(toolCall.arguments)
        )
    };
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
