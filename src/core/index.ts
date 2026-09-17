import { createModels } from "@earendil-works/pi-ai"
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { type JarvixEvent, type JarvixListener } from "../portocol/event";

export class Jarvix {
    private listeners = new Set<JarvixListener>();

    constructor() {

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
        this.emit({
            type: "log",
            level: "log",
            text: "This is a log test message"
        })
        this.emit({
            type: "log",
            level: "info",
            text: "This is a info test message"
        })
    }

    async request(question: string) {
        const models = builtinModels();
        const model = models.getModel("deepseek", "deepseek-v4-flash");
        if(!model){
            console.error("Model not found");
            return;
        }
        const stream = models.stream(model, {
            messages: [
                {
                    role: "user",
                    content: "Hi",
                    timestamp: Date.now()
                },{
                    role: "user",
                    content: question,
                    timestamp: Date.now()
                },{
                    role: "user",
                    content: question,
                    timestamp: Date.now()
                }
            ] 
        },
        {
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
                    console.log("text_start" + event.contentIndex)
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
                    console.log("text_delta" + event.contentIndex)
                    break;
                case "text_end":
                    this.emit({
                        type: "text.end",
                        contentIndex: event.contentIndex
                    })
                    console.log("text_end" + event.contentIndex)
                    break;
                case "thinking_start":
                    this.emit({
                        type: "thinking.start",
                        contentIndex: event.contentIndex
                    })
                    console.log("thinking_start" + event.contentIndex)
                    break;
                case "thinking_delta":
                    this.emit({
                        type: "thinking.delta",
                        contentIndex: event.contentIndex,
                        delta: event.delta
                    })
                    console.log("thinking_delta" + event.contentIndex)
                    break;
                case "thinking_end":
                    this.emit({
                        type: "thinking.end",
                        contentIndex: event.contentIndex
                    })
                    console.log("thinking_end" + event.contentIndex)
                    break;
                case "toolcall_start":
                    break;
                case "toolcall_delta":
                    break;
                case "toolcall_end":
                    break;
                case "done":
                    this.emit({
                    type: "done",
                    reason: event.reason,
                    message: event.message
                })
                    break;
                case "error":
                    this.emit({
                        type: "error",
                        error: event.error.errorMessage
                    })
                    console.error(event.error.errorMessage);
                    break;
            }
        }
    }
}
