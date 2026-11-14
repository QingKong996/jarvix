import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { parseModelsDevCatalog } from "../llm/catalog.ts";
import { providerCatalogEntrySchema, type ModelCatalog } from "../protocol/providers.ts";

const TTL = 24 * 60 * 60 * 1000;
const CACHE_VERSION = 4;
const cacheSchema = z.object({
    version: z.literal(CACHE_VERSION),
    providers: z.array(providerCatalogEntrySchema).min(1),
    fetchedAt: z.number()
});

export class ModelCatalogService {
    private cached?: ModelCatalog;
    private pending?: Promise<ModelCatalog>;
    private readonly file: string;
    private readonly fetchCatalog: typeof fetch;

    constructor(file: string, fetchCatalog: typeof fetch = fetch) {
        this.file = file;
        this.fetchCatalog = fetchCatalog;
    }

    async get(force = false): Promise<ModelCatalog> {
        if (!this.cached) {
            try {
                const { version: _version, ...cached } = cacheSchema.parse(JSON.parse(await readFile(this.file, "utf8")));
                this.cached = { ...cached, stale: false };
            } catch { /* A missing or invalid cache is refreshed from the source. */ }
        }
        if (!force && this.cached) {
            if (Date.now() - this.cached.fetchedAt < TTL) return this.cached;
            void this.refresh().catch(() => undefined);
            return { ...this.cached, stale: true };
        }
        return this.refresh();
    }

    private refresh(): Promise<ModelCatalog> {
        if (this.pending) return this.pending;
        this.pending = this.fetch().finally(() => { this.pending = undefined; });
        return this.pending;
    }

    private async fetch(): Promise<ModelCatalog> {
        try {
            const response = await this.fetchCatalog("https://models.dev/api.json", { signal: AbortSignal.timeout(5000) });
            if (!response.ok) throw new Error(`models.dev: HTTP ${response.status}`);
            const next = { providers: parseModelsDevCatalog(await response.json()), fetchedAt: Date.now(), stale: false };
            await mkdir(dirname(this.file), { recursive: true });
            await writeFile(`${this.file}.tmp`, JSON.stringify({ version: CACHE_VERSION, ...next }), "utf8");
            await rename(`${this.file}.tmp`, this.file);
            this.cached = next;
            return next;
        } catch (error) {
            if (this.cached) return { ...this.cached, stale: true };
            throw error;
        }
    }
}
