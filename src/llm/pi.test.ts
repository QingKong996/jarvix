import {
    createModels,
    fauxAssistantMessage,
    fauxProvider,
    fauxText,
    fauxThinking
} from "@earendil-works/pi-ai";
import type { Context } from "@earendil-works/pi-ai";
import { expect, test } from "vitest";
import { createPiAdapter } from "./pi.ts";
import type { LlmAssistantMessage, LlmMessage, LlmStreamEvent } from "./types.ts";

function createFixture() {
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);

    const adapter = createPiAdapter({ models });
    const fauxModel = faux.getModel();
    const model = adapter.getModel(fauxModel.provider, fauxModel.id);
    if (!model) {
        throw new Error("Faux model was not registered");
    }
    return { faux, adapter, model };
}

function userMessage(content: string): LlmMessage {
    return { role: "user", content, timestamp: Date.now() };
}

function deltas(events: LlmStreamEvent[], type: "text.delta" | "thinking.delta"): string {
    return events
        .filter((event): event is Extract<LlmStreamEvent, { type: "text.delta" | "thinking.delta" }> =>
            event.type === type
        )
        .map((event) => event.delta)
        .join("");
}

test("maps pi stream events onto the unified stream", async () => {
    const { faux, adapter, model } = createFixture();
    faux.setResponses([fauxAssistantMessage([fauxThinking("plan"), fauxText("answer")])]);

    const events: LlmStreamEvent[] = [];
    for await (const event of adapter.stream({ model, messages: [userMessage("hi")] })) {
        events.push(event);
    }

    expect(events[0]).toEqual({ type: "start" });
    expect(events.at(-1)?.type).toBe("done");
    expect(deltas(events, "text.delta")).toBe("answer");
    expect(deltas(events, "thinking.delta")).toBe("plan");

    expect(events.at(-1)).toMatchObject({
        type: "done",
        message: {
            provider: model.provider,
            model: model.id,
            stopReason: "stop",
            content: [
                { type: "thinking", thinking: "plan" },
                { type: "text", text: "answer" }
            ]
        }
    });
});

test("maps provider errors onto error events", async () => {
    const { adapter, model } = createFixture();

    const events: LlmStreamEvent[] = [];
    for await (const event of adapter.stream({ model, messages: [userMessage("hi")] })) {
        events.push(event);
    }

    expect(events.at(-1)).toMatchObject({
        type: "error",
        message: { stopReason: "error", errorMessage: "No more faux responses queued" }
    });
});

test("replays assistant messages with their provider metadata", async () => {
    const { faux, adapter, model } = createFixture();
    faux.setResponses([fauxAssistantMessage([fauxThinking("plan"), fauxText("answer")])]);

    let reply: LlmAssistantMessage | undefined;
    for await (const event of adapter.stream({ model, messages: [userMessage("hi")] })) {
        if (event.type === "done") {
            reply = event.message;
        }
    }
    if (!reply) {
        throw new Error("Expected a final assistant message");
    }

    const seen: { context?: Context } = {};
    faux.setResponses([
        (context) => {
            seen.context = context;
            return fauxAssistantMessage("second");
        }
    ]);

    for await (const _event of adapter.stream({
        model,
        messages: [userMessage("hi"), reply],
        systemPrompt: "Be brief."
    })) {
        // Drain the stream; the scripted response is captured above.
    }

    expect(seen.context?.messages.map((message) => message.role)).toEqual(["system", "user", "assistant"]);
    expect(seen.context?.messages[2]).toMatchObject({
        role: "assistant",
        provider: model.provider,
        model: model.id,
        content: [
            { type: "thinking", thinking: "plan" },
            { type: "text", text: "answer" }
        ]
    });
    expect(seen.context?.messages[0]).toMatchObject({ role: "system", content: "Be brief." });
});

test("passes tool definitions and tool results to the provider context", async () => {
    const { faux, adapter, model } = createFixture();
    let context: Context | undefined;
    faux.setResponses([
        (next) => {
            context = next;
            return fauxAssistantMessage("done");
        }
    ]);

    for await (const _event of adapter.stream({
        model,
        messages: [userMessage("run it"), {
            role: "assistant",
            content: [{
                type: "toolCall",
                id: "call-1",
                name: "exec_command",
                arguments: { command: "echo hi", cwd: "/tmp", timeoutMs: 1000 }
            }],
            provider: model.provider,
            model: model.id,
            api: "test",
            usage: {
                inputTokens: 0,
                outputTokens: 0,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                totalTokens: 0,
                cost: 0
            },
            stopReason: "toolUse",
            timestamp: 2
        }, {
            role: "toolResult",
            toolCallId: "call-1",
            toolName: "exec_command",
            content: "hi\n",
            isError: false,
            timestamp: 3
        }],
        tools: [{
            name: "exec_command",
            description: "Run a command",
            parameters: { type: "object", properties: {} }
        }]
    })) {
        // Drain the stream; the provider context is captured above.
    }

    expect(context?.messages[0]).toMatchObject({
        role: "system",
        toolsAdded: [{
            name: "exec_command",
            description: "Run a command",
            parameters: { type: "object", properties: {} }
        }]
    });
    expect(context?.messages.map((message) => message.role)).toEqual([
        "system",
        "user",
        "assistant",
        "toolResult"
    ]);
});

test("passes background task notices through system messages", async () => {
    const { faux, adapter, model } = createFixture();
    let context: Context | undefined;
    faux.setResponses([
        (next) => {
            context = next;
            return fauxAssistantMessage("done");
        }
    ]);

    for await (const _event of adapter.stream({
        model,
        messages: [userMessage("run it"), {
            role: "system",
            content: "Background task shell-1 exited with code 0.",
            timestamp: 2
        }]
    })) {
        // Drain the stream; the provider context is captured above.
    }

    expect(JSON.stringify(context?.messages)).toContain("Background task shell-1 exited with code 0.");
});
