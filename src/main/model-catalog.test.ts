import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test, vi } from "vitest";
import { ModelCatalogService } from "./model-catalog.ts";
import { parseModelsDevCatalog } from "../llm/catalog.ts";

const fixture = { example: { id: "example", name: "Example", npm: "@ai-sdk/openai-compatible",
    api: "https://example.com/v1", models: { chat: { id: "chat", name: "Chat", limit: { context: 128000, output: 8192 } } } } };
const directory = await mkdtemp(join(tmpdir(), "jarvix-catalog-"));
afterAll(() => rm(directory, { recursive: true, force: true }));

test("shares refresh requests and persists only validated catalog data", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(fixture)));
    const file = join(directory, "catalog.json");
    const service = new ModelCatalogService(file, request);
    const [first, second] = await Promise.all([service.get(), service.get()]);
    expect(first).toEqual(second);
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await readFile(file, "utf8")).providers).toEqual(parseModelsDevCatalog(fixture));
    await service.get();
    expect(request).toHaveBeenCalledTimes(1);

    const offline = new ModelCatalogService(file, vi.fn<typeof fetch>().mockRejectedValue(new Error("Offline")));
    expect(await offline.get()).toEqual(first);
    expect(await offline.get(true)).toEqual({ ...first, stale: true });
});

test("serves stale persisted data offline and reports an initial fetch failure", async () => {
    const file = join(directory, "stale.json");
    await writeFile(file, JSON.stringify({ version: 4, providers: parseModelsDevCatalog(fixture), fetchedAt: 1 }));
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error("Offline"));
    expect(await new ModelCatalogService(file, request).get()).toMatchObject({ fetchedAt: 1, stale: true });
    await expect(new ModelCatalogService(join(directory, "missing.json"), request).get()).rejects.toThrow("Offline");
});
