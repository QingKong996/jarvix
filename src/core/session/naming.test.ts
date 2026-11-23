import { expect, test } from "vitest";
import type { LlmAdapter } from "../llm/index.ts";
import type {
    LlmAssistantMessage,
    LlmModelInfo,
    LlmStreamEvent
} from "../../protocol/llm.ts";
import { providerConfigSchema } from "../../protocol/providers.ts";
import { generateSessionName } from "./naming.ts";

const MODEL: LlmModelInfo = {
    provider: "test",
    id: "test-model",
    name: "Test",
    reasoning: false,
    contextWindow: 1_000,
    maxTokens: 100
};

const CONFIG = {
    providers: [providerConfigSchema.parse({
        id: MODEL.provider,
        name: MODEL.name,
        protocol: "openai-completions",
        baseUrl: "http://localhost:8080/v1",
        models: [{ id: MODEL.id, name: MODEL.name }]
    })],
    selectedModel: { provider: MODEL.provider, id: MODEL.id }
};

function assistantMessage(text: string): LlmAssistantMessage {
    return {
        role: "assistant",
        content: text.length > 0 ? [{ type: "text", text }] : [],
        provider: MODEL.provider,
        model: MODEL.id,
        api: "test",
        usage: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 0,
            cost: 0
        },
        stopReason: "stop",
        timestamp: 0
    };
}

function replyLlm(text: string, streamText = text): LlmAdapter {
    return {
        getModel: () => MODEL,
        stream() {
            return (async function* (): AsyncIterable<LlmStreamEvent> {
                if (streamText.length > 0) {
                    yield { type: "text.delta", index: 0, delta: streamText };
                }
                yield { type: "done", message: assistantMessage(text) };
            })();
        }
    };
}

test.each([
    [
        "an English markdown label",
        "# **Title: \"Fix the login race\"**。\nignored line",
        "Fix the login race"
    ],
    [
        "a Chinese markdown label",
        "## 会话标题： “修复登录竞态”。",
        "修复登录竞态"
    ],
    ["surrounding quotes", "\"Release checklist\"", "Release checklist"]
])("normalizes %s", async (_label, response, expected) => {
    const name = await generateSessionName(
        replyLlm(response),
        CONFIG,
        "Investigate the login race"
    );

    expect(name).toBe(expected);
});

test("falls back to the completed assistant message when no text was streamed", async () => {
    const name = await generateSessionName(
        replyLlm("  \"修复登录竞态\"  ", ""),
        CONFIG,
        "修复登录竞态"
    );

    expect(name).toBe("修复登录竞态");
});

test("rejects a response that contains no usable title", async () => {
    await expect(generateSessionName(replyLlm(" \n ### \n "), CONFIG, "Name it"))
        .rejects.toThrow("The model returned an empty session name");
});
