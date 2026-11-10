import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { JarvixConfig } from "../protocol/config.ts";
import { type AssistantBlock, type JarvixEvent, type JarvixListener } from "../protocol/event.ts";
import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";

export class Jarvix {
    private listeners = new Set<JarvixListener>();
    private messages: (AssistantMessage | UserMessage)[] = [];
    private config: JarvixConfig;
    constructor(config: JarvixConfig = {}) {
        this.config = config;
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

    async request(question: string) {
        const models = builtinModels();
        const model = models.getModel("deepseek", "deepseek-v4-flash");
        if(!model){
            this.emit({ type: "error", error: "Model not found: deepseek/deepseek-v4-flash" });
            return;
        }

        this.messages.push({
            role: "user",
            content: question,
            timestamp: Date.now()
        })
        const stream = models.stream(model, {
                systemPrompt: "Response user in Chinese",
                messages: this.messages
            },
            {
                apiKey: this.config.apiKey,
                reasoning: true,
                reasoningEffort: "xhigh"
            })

        for await (const event of stream){
            switch(event.type){
                case "text_start":
                    this.emit({
                        type: "text.start",
                        contentIndex: event.contentIndex
                    })
                    break;
                case "start":
                    this.emit({
                        type: "start"
                    })
                    break;
                case "text_delta":
                    this.emit({
                        type: "text.delta",
                        contentIndex: event.contentIndex,
                        delta: event.delta
                    })
                    break;
                case "text_end":
                    this.emit({
                        type: "text.end",
                        contentIndex: event.contentIndex
                    })
                    break;
                case "thinking_start":
                    this.emit({
                        type: "thinking.start",
                        contentIndex: event.contentIndex
                    })
                    break;
                case "thinking_delta":
                    this.emit({
                        type: "thinking.delta",
                        contentIndex: event.contentIndex,
                        delta: event.delta
                    })
                    break;
                case "thinking_end":
                    this.emit({
                        type: "thinking.end",
                        contentIndex: event.contentIndex
                    })
                    break;
                case "done": {
                    const blocks: AssistantBlock[] = []
                    event.message.content.forEach((item, index) => {
                        switch(item.type){
                            case "text":
                                blocks.push({
                                    type: "text",
                                    index,
                                    text: item.text
                                })
                                break;
                            case "thinking":
                                blocks.push({
                                    type: "thinking",
                                    index,
                                    thinking: item.thinking
                                })
                                break;
                        }
                    })

                    this.emit({
                        type: "done",
                        reason: event.reason,
                        blocks: blocks
                    })
                    break;
                }
                case "error":
                    this.emit({
                        type: "error",
                        error: event.error.errorMessage
                    })
                    console.error(event.error.errorMessage);
                    break;
            }
        }

        const finalMessage: AssistantMessage = await stream.result()
        this.messages.push(finalMessage)
    }
}
