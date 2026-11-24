import type { LlmMessage } from "../../protocol/llm.ts";

export function finalAssistantText(messages: readonly LlmMessage[]): string {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index]!;
        if (message.role !== "assistant") {
            continue;
        }
        return message.content
            .filter((block) => block.type === "text")
            .map((block) => block.type === "text" ? block.text : "")
            .join("\n")
            .trim();
    }
    return "";
}
