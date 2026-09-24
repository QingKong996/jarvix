import { createCliRenderer } from "@opentui/core"
import { createRoot, useRenderer } from "@opentui/react"
import { useEffect, useState, useRef } from "react";
import { type JarvixEvent } from "../portocol/event.ts";
import { Jarvix } from "../core";
import { setJarvix, getJarvix } from "./runtime.ts"
import { TUIRelayer } from "./TUIrelayer.ts";
import { type LogLevel } from "../portocol/event.ts";
import { type JarvixMessage } from "../portocol/event.ts";


type AppProps = {
    relayer: TUIRelayer
}


type TUIMessage = 
  | {
    role: "log"
    level: LogLevel
    text: string
} | JarvixMessage


function App ({relayer} : AppProps) {
    const renderer = useRenderer();

    const [input, setInput] = useState("");
    const [messages, setMessages] = useState<TUIMessage[]>([]);
    const [streamingMessage, setStreamingMessage] = useState<JarvixMessage[]>([]);
    const streamingMessageRef = useRef<JarvixMessage[]>([]);

    useEffect(() => {
        const methods = ["log", "info", "warn", "error", "debug"] as const;

        const originals = Object.fromEntries(
            methods.map(method => [method, console[method]])
        ) as Record<
            typeof methods[number],
            (...args: unknown[]) => void
            >;

        for(const method of methods) {
            console[method] = (...args: unknown[]) => {
                const text = args
                    .map(arg =>
                        typeof arg === "string"
                        ? arg
                        : Bun.inspect(arg, {colors: false})
                    ).join(" ");
                setMessages(prev => [...prev, {
                    role: "log",
                    level: method,
                    text: text
                }])
            }
        }


        return () => {
            for(const method of methods){
                console[method] = originals[method];
            }
        }
    }, [])


    function updateStreamingMessage(
        updater: (prev: JarvixMessage[]) => JarvixMessage[]
    ){
        const next = updater(streamingMessageRef.current);

        streamingMessageRef.current = next;
        setStreamingMessage(next);
    }

    useEffect(() => {
        return relayer.subscribe((event: JarvixEvent) => {
            switch(event.type){
                case "log":
                    console[event.level](event.text);
                    break;
                case "text.delta":
                    updateStreamingMessage(prev => {
                        const next = [...prev];
                        const msg = next[event.contentIndex]
                        if(
                            msg != undefined &&
                            msg.role === "assistant" &&
                            msg.content.type === "text"
                          ){
                            msg.content.text += event.delta
                        }
                        return next;
                    })
                    break;
                case "text.start":
                    updateStreamingMessage(prev => {
                        const next = [...prev];
                        if(next[event.contentIndex] === undefined){
                            next[event.contentIndex] = {
                                role: "assistant",
                                content: {
                                    type: "text",
                                    text: ""
                                }
                            }
                        }
                        return next;
                    })
                    break;
                case "text.end":
                  break;
                case "thinking.delta":
                    updateStreamingMessage(prev => {
                        const next = [...prev];
                        const msg = next[event.contentIndex]
                        if(
                            msg != undefined &&
                            msg.role === "assistant" &&
                            msg.content.type === "thinking"
                          ){
                            msg.content.thinking += event.delta
                        }
                        return next;
                    })
                     break;
                case "thinking.start":
                    updateStreamingMessage(prev => {
                        const next = [...prev];
                        if(next[event.contentIndex] === undefined){
                            next[event.contentIndex] = {
                                role: "assistant",
                                content: {
                                    type: "thinking",
                                    thinking: ""
                                }
                            }
                        }
                        return next;
                    })
                    break;
                case "thinking.end":
                   break;
                case "error":
                    console.error(Bun.inspect(event.error))
                    break;
                case "done":
                    switch(event.reason){
                        case "stop":
                            setMessages(prev => [...prev, ...event.content])
                            updateStreamingMessage(prev => {
                                return []
                            })
                            break;
                        case "length":
                        case "toolUse":
                    }
                    break;
                case "start":
             }
        })
    }, [relayer])




    function submit(value: string){
        if(value == "/exit"){
            renderer.destroy();
            process.stdin.destroy();
            return;
        }else if(value == "/test"){
            getJarvix().test();
        }else{
            getJarvix().request(value);
            console.log(`Send request: ${value}`)
        }
        setInput("");
    }



    return <box style={{
        border:true
    }}>
    <scrollbox  
        stickyStart = "bottom"
        stickyScroll = {true}
    >
        {
            messages.map((message, index) => {
                switch(message.role){
                    case "log":
                        switch(message.level){
                            case "log":
                                return <text key={index}>[<span fg="white">LOG</span>]{message.text}</text>
                            case "info":
                                return <text key={index}>[<span fg="cyan">INFO</span>]{message.text}</text>
                            case "warn":
                                return <text key={index}>[<span fg="yellow">WARN</span>]{message.text}</text>
                            case "error":
                                return <text key={index}>[<span fg="red">ERROR</span>]{message.text}</text>
                            case "debug":
                                return <text key={index}>[<span fg="gray">DEBUG</span>]{message.text}</text>
                        }
                    case "user":
                        return <text key={index}>User:{message.content.text}</text>
                    case "assistant":
                        switch(message.content.type){
                            case "text":
                                return <text key={index}>Assistant:{message.content.text}</text>
                            case "thinking":
                                return <text key={index}>Thinking:{message.content.thinking}</text>
                        }

                }
            })
        }
        {
            streamingMessage.map((message, index) => {
                switch(message.role){
                    case "user":
                        return <text style={{fg: "red"}} key={index}>User:{message.content.text}</text>
                    case "assistant":
                        switch(message.content.type){
                            case "text":
                                return <text style={{fg: "red"}} key={index}>Assistant:{message.content.text}</text>
                            case "thinking":
                                return <text style={{fg: "red"}} key={index}>Thinking:{message.content.thinking}</text>
                        }

                }
            })
        }
    </scrollbox>
    <box style={{
        border: true,
        height: 3,
        flexShrink: 0
    }}>
        <input 
            value = { input }
            onInput = { setInput }
            onSubmit = { submit }
            focused
        />
    </box>
    </box>
}



export async function startTUI(jarvix: Jarvix){
    setJarvix(jarvix);

    const renderer = await createCliRenderer({
        consoleMode: "disabled",
        // exitOnCtrlC: false
    });

    const tuiRelayer = new TUIRelayer()

    jarvix.subscribe(tuiRelayer.listener);

    const root = createRoot(renderer);
    root.render(<App relayer={tuiRelayer}/>)
}


