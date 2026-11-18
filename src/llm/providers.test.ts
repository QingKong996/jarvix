import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "vitest";
import { providerConfigSchema } from "../protocol/providers.ts";
import { createPiAdapter } from "./pi.ts";
import { configuredModels } from "./providers.ts";

test("streams through a custom endpoint with the selected model and credential", async () => {
    let body: Record<string, unknown> | undefined;
    let authorization: string | undefined;
    let path: string | undefined;
    const server = createServer(async (request, response) => {
        let payload = "";
        for await (const chunk of request) payload += chunk;
        body = JSON.parse(payload);
        authorization = request.headers.authorization;
        path = request.url;
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        response.write(`data: ${JSON.stringify({ id: "reply", model: "local-chat", choices: [{ index: 0, delta: { role: "assistant", content: "Hello" }, finish_reason: null }] })}\n\n`);
        response.write(`data: ${JSON.stringify({ id: "reply", model: "local-chat", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } })}\n\n`);
        response.end("data: [DONE]\n\n");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
        const port = (server.address() as AddressInfo).port;
        let providers = [providerConfigSchema.parse({ id: "custom:local", name: "Local", protocol: "openai-completions",
            baseUrl: `http://127.0.0.1:${port}/v1`, models: [{ id: "local-chat", name: "Local Chat" }] })];
        const adapter = createPiAdapter({ providers: () => providers });
        const model = adapter.getModel("custom:local", "local-chat")!;
        expect(model.name).toBe("Local Chat");
        const events = [];
        for await (const event of adapter.stream({
            model,
            apiKey: "local-key",
            messages: [{ role: "user", content: "Hi", timestamp: 1 }]
        })) events.push(event);
        expect(path).toBe("/v1/chat/completions");
        expect(authorization).toBe("Bearer local-key");
        expect(body?.model).toBe("local-chat");
        expect(events.at(-1)).toMatchObject({ type: "done", message: { provider: "custom:local", model: "local-chat" } });
        providers = [{ ...providers[0]!, models: [] }];
        expect(adapter.getModel("custom:local", "local-chat")).toBeUndefined();
    } finally {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
});

test("inherits built-in compatibility metadata for configured models", () => {
    const providers = [providerConfigSchema.parse({
        id: "deepseek",
        name: "DeepSeek",
        protocol: "openai-completions",
        baseUrl: "https://api.deepseek.com",
        models: [{ id: "deepseek-flash", name: "DeepSeek Flash", reasoning: true }]
    })];
    const model = configuredModels(providers).getModel("deepseek", "deepseek-flash");

    expect(model?.compat).toMatchObject({
        supportsDeveloperRole: false,
        maxTokensField: "max_tokens",
        thinkingFormat: "deepseek"
    });
});

test("leaves Responses compatibility defaults to pi and keeps model-level overrides", () => {
    const providers = [providerConfigSchema.parse({
        id: "custom:responses",
        name: "Custom Responses",
        protocol: "openai-responses",
        baseUrl: "https://example.com/v1",
        models: [
            { id: "portable", name: "Portable" },
            {
                id: "system",
                name: "System",
                compat: {
                    supportsDeveloperRole: false,
                    supportsMidConvoSystemMessages: false
                }
            }
        ]
    })];
    const models = configuredModels(providers);

    expect(models.getModel("custom:responses", "portable")?.compat).toBeUndefined();
    expect(models.getModel("custom:responses", "system")?.compat).toEqual({
        supportsDeveloperRole: false,
        supportsMidConvoSystemMessages: false
    });
});

test("uses explicit mid-conversation system compatibility", async () => {
    const providers = [providerConfigSchema.parse({
        id: "custom:responses",
        name: "Custom Responses",
        protocol: "openai-responses",
        baseUrl: "https://example.com/v1",
        models: [{
            id: "portable",
            name: "Portable",
            reasoning: true,
            compat: { supportsMidConvoSystemMessages: true }
        }]
    })];
    const models = configuredModels(providers);
    const model = models.getModel("custom:responses", "portable");
    if (!model) {
        throw new Error("Responses model was not registered");
    }

    let payload: { input?: Array<{ role: string; content: unknown }> } | undefined;
    for await (const _event of models.streamSimple(model, {
        systemPrompt: "Base system.",
        messages: [
            { role: "user", content: "first", timestamp: 1 },
            { role: "system", content: "NOTICE_A", timestamp: 2 },
            { role: "user", content: "second", timestamp: 3 }
        ]
    }, {
        apiKey: "test",
        onPayload: (next) => {
            payload = next as typeof payload;
            throw new Error("payload captured");
        }
    })) {
    }

    expect(payload?.input?.map((message) => message.role)).toEqual([
        "developer",
        "user",
        "developer",
        "user"
    ]);
    expect(payload?.input?.[0]?.content).toBe("Base system.");
    expect(payload?.input?.[2]?.content).toBe("NOTICE_A");
});
