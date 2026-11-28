import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    truncateSync,
    writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { DEFAULT_THEME } from "../../protocol/config.ts";
import { providerConfigSchema } from "../../protocol/providers.ts";
import {
    configPaths,
    loadConfig,
    parseConfig,
    saveConfig,
    serializeConfig,
    systemDefaults,
    type ConfigDefaults
} from "./config.ts";

const base = mkdtempSync(join(tmpdir(), "jarvix-config-"));

const defaults: ConfigDefaults = { language: "zh", theme: "dark" };

test("round-trips provider defaults and rejects invalid selections and duplicate identifiers", () => {
    const provider = providerConfigSchema.parse({ id: "custom:test", name: "Test", protocol: "openai-completions",
        baseUrl: "http://localhost:8080/v1/", apiKey: " key ", models: [{ id: "chat", name: "Chat", reasoning: true }] });
    const config = { providers: [provider], selectedModel: { provider: provider.id, id: "chat" }, reasoning: "high" as const };
    const paths = configPaths(join(base, "providers"));
    saveConfig(config, paths, defaults);
    expect(loadConfig(paths, defaults)).toMatchObject(config);
    expect(provider.apiKey).toBe("key");
    expect(() => parseConfig({ ...config, selectedModel: { provider: provider.id, id: "missing" } })).toThrow(/Selected model/);
    expect(() => parseConfig({ ...config, providers: [provider, provider] })).toThrow(/Duplicate provider/);
    expect(() => parseConfig({ providers: [{ ...provider, models: [provider.models[0], provider.models[0]] }] })).toThrow(/Duplicate model/);
});

test("rejects models that reserve the entire context window for output", () => {
    const provider = {
        id: "custom:test",
        name: "Test",
        protocol: "openai-completions",
        baseUrl: "http://localhost:8080/v1",
        models: [{
            id: "chat",
            name: "Chat",
            contextWindow: 8_192,
            maxTokens: 8_192
        }]
    };

    expect(() => parseConfig({ providers: [provider] }, defaults)).toThrow(/less than the context window/);

    const valid = {
        ...provider,
        models: [{ ...provider.models[0], maxTokens: 8_191 }]
    };
    expect(parseConfig({ providers: [valid] }, defaults).providers?.[0]?.models[0]?.maxTokens)
        .toBe(8_191);
});

test("syncs the selected model and reasoning with configured models", () => {
    const provider = providerConfigSchema.parse({
        id: "custom:test", name: "Test", protocol: "openai-completions", baseUrl: "http://localhost:8080/v1",
        models: [
            { id: "fast", name: "Fast", reasoning: true, reasoningLevels: ["low", "high"] },
            { id: "plain", name: "Plain" }
        ]
    });

    expect(parseConfig({ providers: [provider], reasoning: "max" }, defaults)).toMatchObject({
        selectedModel: { provider: provider.id, id: "fast" },
        reasoning: "high"
    });
    expect(parseConfig({
        providers: [provider],
        selectedModel: { provider: provider.id, id: "plain" },
        reasoning: "high"
    }, defaults)).not.toHaveProperty("reasoning");

    const deepseek = providerConfigSchema.parse({
        id: "deepseek", name: "DeepSeek", protocol: "openai-completions", baseUrl: "https://api.deepseek.com",
        models: [{ id: "chat", name: "Chat" }]
    });
    expect(parseConfig({ providers: [deepseek] }, defaults)).toMatchObject({
        selectedModel: { provider: deepseek.id, id: "chat" }
    });
});

afterAll(() => {
    rmSync(base, { recursive: true, force: true });
});

test("systemDefaults derives the language from the system locale", () => {
    expect(systemDefaults("zh-CN")).toEqual({ language: "zh", theme: DEFAULT_THEME });
    expect(systemDefaults("en-US")).toEqual({ language: "en", theme: DEFAULT_THEME });
    expect(systemDefaults("fr-FR")).toEqual({ language: "en", theme: DEFAULT_THEME });
});

test("parseConfig drops unknown fields", () => {
    expect(parseConfig({ model: "deepseek" }, defaults)).toEqual({ language: "zh", theme: "dark" });
});

test("parseConfig keeps a supported language", () => {
    expect(parseConfig({ language: "en" }, defaults)).toEqual({
        language: "en",
        theme: "dark"
    });
});

test("parseConfig falls back to the default language for an unsupported language", () => {
    expect(parseConfig({ language: "fr" }, defaults)).toEqual({ language: "zh", theme: "dark" });
});

test("parseConfig keeps a supported theme", () => {
    expect(parseConfig({ theme: "light" }, defaults)).toEqual({ language: "zh", theme: "light" });
});

test("parseConfig falls back to the default theme for an unsupported theme", () => {
    expect(parseConfig({ theme: "system" }, defaults)).toEqual({ language: "zh", theme: "dark" });
});

test("parseConfig rejects data that is not an object", () => {
    expect(() => parseConfig(null, defaults)).toThrow(/Invalid config/);
    expect(() => parseConfig("sk-test", defaults)).toThrow(/Invalid config/);
    expect(() => parseConfig([], defaults)).toThrow(/Invalid config/);
    expect(() => parseConfig(undefined, defaults)).toThrow(/Invalid config/);
});

test("serializeConfig writes the complete default config set", () => {
    expect(serializeConfig({}, defaults)).toEqual({ language: "zh", theme: "dark" });
});

test("saveConfig and loadConfig round-trip the config data object", () => {
    const paths = configPaths(join(base, "round-trip"));

    saveConfig({ language: "en", theme: "light" }, paths, defaults);
    expect(loadConfig(paths, defaults)).toEqual({ language: "en", theme: "light" });
    expect(readdirSync(paths.directory)).toEqual(["config.json"]);

    saveConfig({}, paths, defaults);
    expect(loadConfig(paths, defaults)).toEqual({ language: "zh", theme: "dark" });
    expect(readdirSync(paths.directory)).toEqual(["config.json"]);
});

test("round-trips the context compaction threshold and rejects invalid values", () => {
    expect(parseConfig({
        contextCompactionThreshold: 32_000
    }, defaults)).toMatchObject({
        language: "zh",
        theme: "dark",
        contextCompactionThreshold: 32_000
    });
    expect(parseConfig({}, defaults)).not.toHaveProperty(
        "contextCompactionThreshold"
    );
    for (const invalid of [0, -1, 1.5, "1000", null]) {
        expect(() => parseConfig({
            contextCompactionThreshold: invalid
        }, defaults)).toThrow(/Invalid config/);
    }

    const paths = configPaths(join(base, "compaction-threshold"));
    saveConfig({
        language: "en",
        theme: "light",
        contextCompactionThreshold: 24_000
    }, paths, defaults);
    expect(loadConfig(paths, defaults)).toEqual({
        language: "en",
        theme: "light",
        contextCompactionThreshold: 24_000
    });
});

test("round-trips the concise transcript preference", () => {
    expect(parseConfig({
        conciseTranscript: true
    }, defaults)).toMatchObject({
        language: "zh",
        theme: "dark",
        conciseTranscript: true
    });
    expect(parseConfig({}, defaults)).not.toHaveProperty("conciseTranscript");
    expect(parseConfig({
        conciseTranscript: "yes"
    }, defaults)).toMatchObject({
        conciseTranscript: false
    });

    const paths = configPaths(join(base, "concise-transcript"));
    saveConfig({
        language: "en",
        theme: "light",
        conciseTranscript: true
    }, paths, defaults);
    expect(loadConfig(paths, defaults)).toEqual({
        language: "en",
        theme: "light",
        conciseTranscript: true
    });
});

test("round-trips skill enablement overrides", () => {
    const skills = {
        "C:\\skills\\one\\SKILL.md": false,
        "C:\\skills\\two\\SKILL.md": true
    };
    expect(parseConfig({ skills }, defaults)).toMatchObject({ skills });

    const paths = configPaths(join(base, "skills"));
    saveConfig({ language: "en", theme: "light", skills }, paths, defaults);
    expect(loadConfig(paths, defaults)).toMatchObject({ skills });
});

test("validates and round-trips MCP server configurations", () => {
    const mcpServers = {
        filesystem: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
        },
        remote: {
            transport: "sse" as const,
            url: "https://example.com/mcp",
            headers: { Authorization: "Bearer test" }
        }
    };
    const parsed = parseConfig({ mcpServers }, defaults);
    expect(parsed.mcpServers).toMatchObject({
        filesystem: {
            transport: "stdio",
            command: "npx"
        },
        remote: {
            transport: "sse",
            url: "https://example.com/mcp"
        }
    });
    expect(() => parseConfig({
        mcpServers: { invalid: {} }
    }, defaults)).toThrow(/exactly one of command or url/);
});

test("saveConfig removes its temporary file when replacement fails", () => {
    const paths = configPaths(join(base, "failed-replace"));
    mkdirSync(paths.file, { recursive: true });

    expect(() => saveConfig({ language: "en" }, paths, defaults)).toThrow();
    expect(readdirSync(paths.directory)).toEqual(["config.json"]);
});

test("saveConfig rejects data that would be ignored on the next launch", () => {
    const paths = configPaths(join(base, "oversized-save"));
    saveConfig({ language: "en", theme: "light" }, paths, defaults);
    const previous = readFileSync(paths.file, "utf8");
    const provider = providerConfigSchema.parse({
        id: "large-provider",
        name: "Large provider",
        protocol: "openai-completions",
        baseUrl: "https://example.com/v1",
        env: [],
        models: [{
            id: "large-model",
            name: "x".repeat(1024 * 1024)
        }]
    });

    expect(() => saveConfig({
        providers: [provider],
        selectedModel: { provider: provider.id, id: provider.models[0]!.id }
    }, paths, defaults)).toThrow(/safe size limit/);
    expect(readFileSync(paths.file, "utf8")).toBe(previous);
    expect(readdirSync(paths.directory)).toEqual(["config.json"]);
});

test("loadConfig fills only the missing fields from the file", () => {
    const paths = configPaths(join(base, "partial"));
    mkdirSync(paths.directory, { recursive: true });
    writeFileSync(paths.file, JSON.stringify({ language: "en" }), "utf8");

    expect(loadConfig(paths, defaults)).toEqual({ language: "en", theme: "dark" });
});

test("loadConfig falls back to the default config when the file is unreadable", () => {
    const paths = configPaths(join(base, "missing"));

    expect(loadConfig(paths, defaults)).toEqual({ language: "zh", theme: "dark" });
});

test("loadConfig falls back to the default config when the content is invalid", () => {
    const paths = configPaths(join(base, "corrupt"));
    mkdirSync(paths.directory, { recursive: true });
    writeFileSync(paths.file, "{not json", "utf8");

    expect(loadConfig(paths, defaults)).toEqual({ language: "zh", theme: "dark" });
});

test("loadConfig ignores files above the safe size limit", () => {
    const paths = configPaths(join(base, "oversized"));
    mkdirSync(paths.directory, { recursive: true });
    writeFileSync(paths.file, "", "utf8");
    truncateSync(paths.file, 16 * 1024 * 1024);

    expect(loadConfig(paths, defaults)).toEqual({ language: "zh", theme: "dark" });
});
