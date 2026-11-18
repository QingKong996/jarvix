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
    text(): string;
    preview: string;
};

export function contextMessagesFor(context: JarvixProviderContext): ContextMessageEntry[] {
    const systemPrompt = context.systemPrompt
        ? [{
            kind: "system" as const,
            text: () => context.systemPrompt,
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
            text: () => message.content,
            preview: previewText(message.content)
        }];
    }
    if (message.role === "toolResult") {
        return [{
            kind: "toolResult",
            text: () => message.content,
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
        const blocksInEntry = assistantBlocks;
        entries.push({
            kind: "assistant",
            text: () => blocksInEntry.map(assistantBlockText).filter(Boolean).join("\n\n"),
            preview: assistantPreview(blocksInEntry)
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
    return {
        kind: "toolCall",
        text: () => [
            toolCall.name,
            JSON.stringify(toolCall.arguments, null, 2)
        ].join("\n"),
        preview: detailPreview(
            toolCall.name,
            previewJson(toolCall.arguments)
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
    const text = value.slice(0, PREVIEW_SCAN_CHARS).replace(/\s+/g, " ").trim();
    return text.length > limit
        ? `${text.slice(0, limit).trimEnd()}…`
        : text;
}

function previewJson(value: unknown): string {
    const chunks: string[] = [];
    let length = 0;
    let truncated = false;

    const append = (text: string): void => {
        if (truncated) {
            return;
        }
        const remaining = PREVIEW_SCAN_CHARS - length;
        if (remaining <= 0) {
            truncated = true;
            return;
        }
        if (text.length > remaining) {
            chunks.push(text.slice(0, remaining));
            length += remaining;
            truncated = true;
            return;
        }
        chunks.push(text);
        length += text.length;
    };

    const visit = (current: unknown, depth: number): void => {
        if (truncated) {
            return;
        }
        if (current === null) {
            append("null");
            return;
        }
        if (typeof current === "string") {
            const remaining = PREVIEW_SCAN_CHARS - length;
            const visible = current.length > remaining
                ? current.slice(0, Math.max(0, remaining))
                : current;
            append(JSON.stringify(visible));
            if (visible.length < current.length) {
                truncated = true;
            }
            return;
        }
        if (typeof current === "number" || typeof current === "boolean") {
            append(JSON.stringify(current));
            return;
        }
        if (typeof current !== "object" || depth >= 8) {
            append("null");
            return;
        }
        if (Array.isArray(current)) {
            append("[");
            for (let index = 0; index < current.length; index += 1) {
                if (truncated) {
                    break;
                }
                if (index > 0) {
                    append(",");
                }
                visit(current[index], depth + 1);
            }
            append("]");
            return;
        }

        append("{");
        let first = true;
        for (const key in current) {
            if (truncated) {
                break;
            }
            if (!Object.prototype.hasOwnProperty.call(current, key)) {
                continue;
            }
            if (!first) {
                append(",");
            }
            first = false;
            append(JSON.stringify(key));
            append(":");
            visit((current as Record<string, unknown>)[key], depth + 1);
        }
        append("}");
    };

    visit(value, 0);
    return `${chunks.join("")}${truncated ? "…" : ""}`;
}

const PREVIEW_SCAN_CHARS = 4_096;
