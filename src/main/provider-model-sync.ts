import { z } from "zod";
import { modelDefinitionSchema, type ModelDefinition } from "../protocol/providers.ts";

const requestSchema = z.object({
    baseUrl: z.string().trim().min(1).refine((value) => {
        try {
            return /^https?:$/.test(new URL(value).protocol);
        } catch {
            return false;
        }
    }, "Expected an HTTP URL"),
    apiKey: z.string().trim().optional(),
    env: z.array(z.string().trim().min(1)).default([])
});

const responseSchema = z.object({
    data: z.array(z.unknown())
});

const modelEntrySchema = z.union([
    z.string(),
    z.object({ id: z.string() }).loose()
]);

function modelsUrl(baseUrl: string): string {
    const url = new URL(baseUrl);
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/models`;
    url.hash = "";
    return url.toString();
}

function apiKeyFor(request: z.infer<typeof requestSchema>): string | undefined {
    if (request.apiKey) return request.apiKey;
    return request.env.map((name) => process.env[name]?.trim()).find(Boolean);
}

export async function syncProviderModels(
    payload: unknown,
    requestModels: typeof fetch = fetch
): Promise<ModelDefinition[]> {
    const parsed = requestSchema.safeParse(payload);
    if (!parsed.success) throw new Error("Invalid provider model sync request");

    const apiKey = apiKeyFor(parsed.data);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const response = await requestModels(modelsUrl(parsed.data.baseUrl), {
        headers,
        signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error(`Provider models: HTTP ${response.status}`);

    const body = responseSchema.safeParse(await response.json());
    if (!body.success) throw new Error("Provider models: invalid response");

    const models: ModelDefinition[] = [];
    const seen = new Set<string>();
    for (const entry of body.data.data) {
        const parsedEntry = modelEntrySchema.safeParse(entry);
        if (!parsedEntry.success) continue;
        const id = (typeof parsedEntry.data === "string" ? parsedEntry.data : parsedEntry.data.id).trim();
        if (!id || seen.has(id)) continue;
        const model = modelDefinitionSchema.safeParse({ id, name: id });
        if (!model.success) continue;
        seen.add(id);
        models.push(model.data);
    }
    return models;
}
