import { mkdir, mkdtemp, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test, vi } from "vitest";
import { parseModelsDevCatalog } from "./models-dev.ts";

const readFileCalls = vi.hoisted(() => [] as string[]);

vi.mock("node:fs/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs/promises")>();
    return {
        ...actual,
        readFile: ((...args: unknown[]) => {
            const [file] = args;
            readFileCalls.push(String(file));
            return (actual.readFile as (...params: unknown[]) => unknown)(...args);
        }) as typeof actual.readFile
    };
});

const { ModelCatalogService } = await import("./model-catalog.ts");

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

test("rejects an oversized catalog response without replacing the cache", async () => {
    const file = join(directory, "oversized.json");
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1));
            controller.close();
        }
    })));

    await expect(new ModelCatalogService(file, request).get()).rejects.toThrow(
        "models.dev: response exceeds"
    );
});

test("refreshes an oversized persisted cache without reading it", async () => {
    const file = join(directory, "oversized-cache.json");
    await writeFile(file, "", "utf8");
    await truncate(file, 8 * 1024 * 1024 + 1);
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(fixture)));
    readFileCalls.length = 0;

    const catalog = await new ModelCatalogService(file, request).get();

    expect(readFileCalls).not.toContain(file);
    expect(request).toHaveBeenCalledTimes(1);
    expect(catalog.providers).toEqual(parseModelsDevCatalog(fixture));
    expect(JSON.parse(await readFile(file, "utf8")).providers).toEqual(parseModelsDevCatalog(fixture));
});

test("serves fetched data when the cache cannot be persisted", async () => {
    const file = join(directory, "unwritable-cache");
    await mkdir(file, { recursive: true });
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(fixture)));
    const service = new ModelCatalogService(file, request);

    const catalog = await service.get();

    expect(catalog.providers).toEqual(parseModelsDevCatalog(fixture));
    expect(await service.get()).toEqual(catalog);
    expect(request).toHaveBeenCalledTimes(1);
    await expect(readFile(`${file}.tmp`, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
});
