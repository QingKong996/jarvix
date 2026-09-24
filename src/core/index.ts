import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { type JarvixEvent, type JarvixListener, type JarvixMessage } from "../portocol/event";
import { type ThinkingContent, type TextContent, type UserMessage, type AssistantMessage, type Tool, type ToolCall } from "@earendil-works/pi-ai";
import { Type, type TSchema } from "@earendil-works/pi-ai";

export class Jarvix {
    private listeners = new Set<JarvixListener>();
    private messages: (AssistantMessage | UserMessage)[] = [];
    private tools: Tool[] = [
        {
            name: "echo",
            description: "Echo the given text",
            parameters: Type.Object({
                text: Type.String
            })

        } 
    ]
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


        // export interface Tool<TParameters extends TSchema = TSchema> {
        //     name: string;
        //     description: string;
        //     parameters: TParameters;
        //     constrainedSampling?: false | ConstrainedSamplingConfig;
        // }
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
            console.error("Model not found");
            return;
        }

        this.messages.push({
            role: "user",
            content: question,
            timestamp: Date.now()
        })
        const stream = models.stream(model, {
                systemPrompt: "Response user in Chinese",
                tools: this.tools,
                messages: this.messages
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
                case "toolcall_start":
                    break;
                case "toolcall_delta":
                    break;
                case "toolcall_end":
                    break;
                                    // export interface AssistantMessage {
                                    //     role: "assistant";
                                    //     content: (TextContent | ThinkingContent | ToolCall)[];
                                    //     api: Api;
                                    //     provider: ProviderId;
                                    //     model: string;
                                    //     responseModel?: string;
                                    //     responseId?: string;
                                    //     diagnostics?: AssistantMessageDiagnostic[];
                                    //     usage: Usage;
                                    //     stopReason: StopReason;
                                    //     deferred?: DeferredHandle;
                                    //     errorMessage?: string;
                                    //     rawStopReason?: string;
                                    //     /**
                                    //      * Provider indication of whether the model explicitly ended its turn.
                                    //      * Preserved for debugging and does not currently affect agent control flow.
                                    //      */
                                    //     endTurn?: boolean;
                                    //     timestamp: number;
                                    // }
                case "done":
                    const content = event.message.content.flatMap<JarvixMessage>(item => {
                        switch(item.type){
                            case "text":
                                return [{
                                role: "assistant",
                                content: {
                                    type: "text",
                                    text: item.text
                                }
                            }]
                            case "thinking":
                                return [{
                                role: "assistant",
                                content: {
                                    type: "thinking",
                                    thinking: item.thinking
                                }
                            }]
                            case "toolCall":
                        }
                        return []
                    })

                    this.emit({
                        type: "done",
                        reason: event.reason,
                        content: content
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

        const finalMessage: AssistantMessage = await stream.result()
        this.messages.push(finalMessage)

        const toolCalls = finalMessage.content.filter(msg => msg.type == "toolCall")
        for(const call of toolCalls){
             switch(call.name){
                 case "echo":
                     console.log(Bun.inspect(call))
                     console.info("ToolCall", call.arguments.text)
                     break;
                 default:
                     console.warn("Unknown toolCall: ", call.name)
             }
        }

    // export interface ToolCall {
    //     type: "toolCall";
    //     id: string;
    //     name: string;
    //     arguments: Record<string, any>;
    //     thoughtSignature?: string;
    //     /** OpenAI Responses namespace for calls to dynamically loaded or namespaced tools. */
    //     namespace?: string;
    // }

    }
}
