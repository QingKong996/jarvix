import { describe, expect, test } from "vitest";
import { providerConfigSchema } from "../../../protocol/providers.ts";
import { applyProviderSave, createProviderInstanceId } from "./ProviderSettings.tsx";

const provider = providerConfigSchema.parse({
    id: "openai",
    name: "OpenAI",
    protocol: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
    models: [{ id: "gpt-test", name: "GPT Test" }]
});

describe("provider settings independence", () => {
    test("catalog additions append a separate provider with a unique instance ID", () => {
        const added = {
            ...provider,
            id: createProviderInstanceId(provider.id, [provider]),
            name: provider.name
        };

        const result = applyProviderSave([provider], undefined, added);

        expect(result).toHaveLength(2);
        expect(result[0]).toBe(provider);
        expect(result[1]).toBe(added);
        expect(added.name).toBe(provider.name);
        expect(added.id).toBe("openai-2");
    });

    test("only an explicit edit session replaces the original provider", () => {
        const edited = { ...provider, name: "My OpenAI" };

        const result = applyProviderSave([provider], provider.id, edited);

        expect(result).toEqual([edited]);
    });
});
