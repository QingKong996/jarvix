import {
    createLlm,
    type LlmAdapter,
    type LlmAssistantMessage,
    type LlmMessage,
    type LlmModelRef
} from "../llm/index.ts";
import type { JarvixConfig } from "../protocol/config.ts";
import { type AssistantBlock, type JarvixEvent, type JarvixListener } from "../protocol/event.ts";

const DEFAULT_MODEL: LlmModelRef = { provider: "deepseek", id: "deepseek-flash" };
const SYSTEM_PROMPT = "Response user in Chinese";

export type JarvixOptions = {
    llm?: LlmAdapter;
    config?: JarvixConfig;
};

export class Jarvix {
    private listeners = new Set<JarvixListener>();
    private messages: LlmMessage[] = [];
    private config: JarvixConfig;
    private readonly llm: LlmAdapter;
    constructor(options: JarvixOptions = {}) {
        this.config = options.config ?? {};
        this.llm = options.llm ?? createLlm();
    }

    setConfig(config: JarvixConfig): void {
        this.config = config;
    }


    private emit(event: JarvixEvent): void {
        for(const listener of this.listeners){
            listener(event);
        }
    }

    subscribe(listener: JarvixListener): (event: JarvixEvent) => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        }
    }


    test(){
        console.log("THIS IS LOG")
        console.info("THIS IS INFO")
        console.warn("THIS IS WARN")
        console.error("THIS IS ERROR")
        console.debug("THIS IS DEBUG")
    }

    async request(question: string): Promise<void> {
        const model = this.llm.getModel(DEFAULT_MODEL.provider, DEFAULT_MODEL.id);
        if (!model) {
            this.emit({ type: "error", error: `Model not found: ${DEFAULT_MODEL.provider}/${DEFAULT_MODEL.id}` });
            return;
        }

        this.messages.push({
            role: "user",
            content: question,
            timestamp: Date.now()
        });

        const stream = this.llm.stream({
            model,
            messages: this.messages,
            systemPrompt: SYSTEM_PROMPT,
            reasoning: "xhigh",
            apiKey: this.config.apiKey
        });

        let completed: LlmAssistantMessage | undefined;

        for await (const event of stream) {
            switch (event.type) {
                case "start":
                    this.emit({
                        type: "start"
                    });
                    break;
                case "text.start":
                    this.emit({
                        type: "text.start",
                        contentIndex: event.index
                    });
                    break;
                case "text.delta":
                    this.emit({
                        type: "text.delta",
                        contentIndex: event.index,
                        delta: event.delta
                    });
                    break;
                case "text.end":
                    this.emit({
                        type: "text.end",
                        contentIndex: event.index
                    });
                    break;
                case "thinking.start":
                    this.emit({
                        type: "thinking.start",
                        contentIndex: event.index
                    });
                    break;
                case "thinking.delta":
                    this.emit({
                        type: "thinking.delta",
                        contentIndex: event.index,
                        delta: event.delta
                    });
                    break;
                case "thinking.end":
                    this.emit({
                        type: "thinking.end",
                        contentIndex: event.index
                    });
                    break;
                case "done":
                    completed = event.message;
                    this.emit({
                        type: "done",
                        reason: event.message.stopReason,
                        blocks: assistantBlocks(event.message)
                    });
                    break;
                case "error":
                    completed = event.message;
                    this.emit({
                        type: "error",
                        error: event.message.errorMessage
                    });
                    console.error(event.message.errorMessage);
                    break;
            }
        }

        if (completed) {
            this.messages.push(completed);
        }
    }
}

function assistantBlocks(message: LlmAssistantMessage): AssistantBlock[] {
    const blocks: AssistantBlock[] = [];
    message.content.forEach((item, index) => {
        switch (item.type) {
            case "text":
                blocks.push({
                    type: "text",
                    index,
                    text: item.text
                });
                break;
            case "thinking":
                blocks.push({
                    type: "thinking",
                    index,
                    thinking: item.thinking
                });
                break;
        }
    });
    return blocks;
}
