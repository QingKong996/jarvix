import { createCliRenderer } from "@opentui/core"
import { createRoot, useRenderer } from "@opentui/react"
import { useEffect, useState, useRef } from "react";
import { type JarvixEvent } from "../portocol/event.ts";
import { Jarvix } from "../core";
import { setJarvix, getJarvix } from "./runtime.ts"
import { TUIRelayer } from "./TUIrelayer.ts";
import { type LogLevel } from "../portocol/event.ts";

type AppProps = {
    relayer: TUIRelayer
}


type TUIMessage = 
  | {
    type: "log"
    index: number
    level: LogLevel
    text: string
} | {
    type: "user.message"
    index: number
    text: string
} | {
    type: "assistant.message.text"
    index: number
    text: string
} | {
    type: "assistant.message.thinking"
    index: number
    text: string
}


function App ({relayer} : AppProps) {
    const renderer = useRenderer();

    const [input, setInput] = useState("");
    const [messages, setMessages] = useState<TUIMessage[]>([]);
    const [streamingMessage, setStreamingMessage] = useState("");
    const streamingMessageRef = useRef("");

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
                    ).join(" ")
                addConsole(`[${method.toUpperCase()}]: ${ text }`, method)
            }
        }


        return () => {
            for(const method of methods){
                console[method] = originals[method];
            }
        }
    }, [])

    useEffect(() => {
        return relayer.subscribe((event: JarvixEvent) => {
            switch(event.type){
                case "log":
                    console[event.level](event.text);
                    break;
                case "text.delta":
                    setStreamingMessage(prev => prev + event.delta);
                    streamingMessageRef.current += event.delta;
                    break;
                case "text.start":
                    console.log("text.start");
                    setStreamingMessage("");
                    streamingMessageRef.current = "";
                    break;
                case "text.end":
                    console.log("text.end");
                    setMessages(prev => [...prev, {
                    type: "assistant.message.text",
                    text: streamingMessageRef.current
                }])
                  break;
                case "thinking.delta":
                    setStreamingMessage(prev => prev + event.delta);
                    streamingMessageRef.current += event.delta;
                     break;
                case "thinking.start":
                    console.log("thinking.start");
                    setStreamingMessage("");
                    streamingMessageRef.current = "";
                    break;
                case "thinking.end":
                    console.log("thinking.end");
                   setMessages(prev => [...prev, {
                   type: "assistant.message.thinking",
                   text: streamingMessageRef.current
                }])
                   break;
                case "error":
                case "done":
                case "start":
             }
        })
    }, [relayer])


    function addConsole(text: string, level: LogLevel){
        setMessages(prev => [...prev, {
            type: "log",
            level: level,
            text: text
        }])
    }


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
                switch(message.type){
                    case "log":
                        return <text key={index}>{message.text}</text>
                    case "user.message":
                        return <text key={index}>User:{message.text}</text>
                    case "assistant.message.text":
                        return <text key={index}>Assistant:{message.text}</text>
                    case "assistant.message.thinking":
                        return <text key={index}>Thinking:{message.text}</text>

                }
            })
        }
        <text style={{
            fg: "red"
        }}>{streamingMessage}</text>
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


