import { mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { type JarvixLogger, noopLogger } from "../../core/logger.ts";
import { parseModelsDevCatalog } from "./models-dev.ts";
import { providerCatalogEntrySchema, type ModelCatalog } from "../../protocol/providers.ts";
import { readJsonResponse } from "./response-body.ts";

const TTL = 24 * 60 * 60 * 1000;
const CACHE_VERSION = 4;
const MAX_CATALOG_RESPONSE_BYTES = 8 * 1024 * 1024;
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
    private readonly logger: JarvixLogger;

    constructor(
        file: string,
        fetchCatalog: typeof fetch = fetch,
        logger: JarvixLogger = noopLogger
    ) {
        this.file = file;
        this.fetchCatalog = fetchCatalog;
        this.logger = logger;
    }

    async get(force = false): Promise<ModelCatalog> {
        if (!this.cached) {
            try {
                const { version: _version, ...cached } = cacheSchema.parse(await readCatalogCache(this.file));
                this.cached = { ...cached, stale: false };
                this.logger.debug("Loaded model catalog cache", {
                    providerCount: this.cached.providers.length
                });
            } catch (error) {
                this.logger.debug("Model catalog cache is unavailable", {
                    reason: errorMessage(error)
                });
            }
        }
        if (!force && this.cached) {
            if (Date.now() - this.cached.fetchedAt < TTL) return this.cached;
            void this.refresh().catch((error: unknown) => {
                this.logger.warn("Background model catalog refresh failed", {
                    reason: errorMessage(error)
                });
            });
            return { ...this.cached, stale: true };
        }
        return this.refresh();
    }

    private refresh(): Promise<ModelCatalog> {
        if (this.pending) {
            this.logger.debug("Reusing pending model catalog refresh");
            return this.pending;
        }
        this.pending = this.fetch().finally(() => { this.pending = undefined; });
        return this.pending;
    }

    private async fetch(): Promise<ModelCatalog> {
        const startedAt = performance.now();
        this.logger.info("Refreshing model catalog");
        try {
            const response = await this.fetchCatalog("https://models.dev/api.json", { signal: AbortSignal.timeout(5000) });
            if (!response.ok) throw new Error(`models.dev: HTTP ${response.status}`);
            const next = {
                providers: parseModelsDevCatalog(
                    await readJsonResponse(response, MAX_CATALOG_RESPONSE_BYTES, "models.dev")
                ),
                fetchedAt: Date.now(),
                stale: false
            };
            await persistCatalogCache(this.file, next, this.logger);
            this.cached = next;
            this.logger.info("Model catalog refreshed", {
                providerCount: next.providers.length,
                durationMs: elapsedMs(startedAt)
            });
            return next;
        } catch (error) {
            if (this.cached) {
                this.logger.warn("Model catalog refresh failed; using stale cache", {
                    reason: errorMessage(error),
                    durationMs: elapsedMs(startedAt)
                });
                return { ...this.cached, stale: true };
            }
            this.logger.error("Model catalog refresh failed", error, {
                durationMs: elapsedMs(startedAt)
            });
            throw error;
        }
    }
}

async function persistCatalogCache(
    file: string,
    catalog: ModelCatalog,
    logger: JarvixLogger
): Promise<void> {
    const temporary = `${file}.tmp`;
    try {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(temporary, JSON.stringify({ version: CACHE_VERSION, ...catalog }), "utf8");
        await rename(temporary, file);
    } catch (error) {
        logger.warn("Failed to persist model catalog cache", {
            file,
            reason: errorMessage(error)
        });
        await rm(temporary, { force: true }).catch(() => undefined);
    }
}

async function readCatalogCache(file: string): Promise<unknown> {
    const descriptor = await open(file, "r");
    try {
        const stats = await descriptor.stat();
        if (!stats.isFile() || stats.size > MAX_CATALOG_RESPONSE_BYTES) {
            throw new Error("Catalog cache exceeds the safe size limit");
        }
        const buffer = Buffer.alloc(stats.size);
        let offset = 0;
        while (offset < buffer.length) {
            const { bytesRead } = await descriptor.read(buffer, offset, buffer.length - offset, offset);
            if (bytesRead === 0) {
                throw new Error("Catalog cache changed while being read");
            }
            offset += bytesRead;
        }
        return JSON.parse(buffer.toString("utf8"));
    } finally {
        await descriptor.close();
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function elapsedMs(startedAt: number): number {
    return Math.round((performance.now() - startedAt) * 10) / 10;
}
