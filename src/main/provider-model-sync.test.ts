import { expect, test, vi } from "vitest";
import { syncProviderModels } from "./provider-model-sync.ts";

test("fetches unique OpenAI-compatible model ids with bearer authentication", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
        data: [{ id: "alpha" }, { id: "beta" }, { id: "alpha" }, { invalid: true }]
    })));

    const models = await syncProviderModels({
        baseUrl: "https://example.com/v1/",
        apiKey: "secret",
        env: []
    }, request);

    expect(request).toHaveBeenCalledOnce();
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe("https://example.com/v1/models");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer secret");
    expect(models.map((model) => model.id)).toEqual(["alpha", "beta"]);
});

test("returns an empty list for an empty response and rejects HTTP failures", async () => {
    const empty = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: [] })));
    expect(await syncProviderModels({ baseUrl: "https://example.com/v1" }, empty)).toEqual([]);

    const failed = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }));
    await expect(syncProviderModels({ baseUrl: "https://example.com/v1" }, failed)).rejects.toThrow("HTTP 401");
});
