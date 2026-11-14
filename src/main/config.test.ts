import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { DEFAULT_THEME } from "../protocol/config.ts";
import { providerConfigSchema } from "../protocol/providers.ts";
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
});

afterAll(() => {
    rmSync(base, { recursive: true, force: true });
});

test("systemDefaults derives the language from the system locale", () => {
    expect(systemDefaults("zh-CN")).toEqual({ language: "zh", theme: DEFAULT_THEME });
    expect(systemDefaults("en-US")).toEqual({ language: "en", theme: DEFAULT_THEME });
    expect(systemDefaults("fr-FR")).toEqual({ language: "en", theme: DEFAULT_THEME });
});

test("parseConfig trims the apiKey", () => {
    expect(parseConfig({ apiKey: "  sk-test  " }, defaults)).toEqual({
        apiKey: "sk-test",
        language: "zh",
        theme: "dark"
    });
});

test("parseConfig fills a missing or blank apiKey with the default config", () => {
    expect(parseConfig({}, defaults)).toEqual({ language: "zh", theme: "dark" });
    expect(parseConfig({ apiKey: "   " }, defaults)).toEqual({ language: "zh", theme: "dark" });
});

test("parseConfig drops unknown fields", () => {
    expect(parseConfig({ apiKey: "sk-test", model: "deepseek" }, defaults)).toEqual({
        apiKey: "sk-test",
        language: "zh",
        theme: "dark"
    });
});

test("parseConfig keeps a supported language", () => {
    expect(parseConfig({ apiKey: "sk-test", language: "en" }, defaults)).toEqual({
        apiKey: "sk-test",
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

test("parseConfig rejects a non-string apiKey", () => {
    expect(() => parseConfig({ apiKey: 42 }, defaults)).toThrow(/Invalid config: apiKey/);
    expect(() => parseConfig({ apiKey: null }, defaults)).toThrow(/Invalid config: apiKey/);
});

test("serializeConfig writes the complete default config set", () => {
    expect(serializeConfig({}, defaults)).toEqual({ language: "zh", theme: "dark" });
    expect(serializeConfig({ apiKey: "sk-test" }, defaults)).toEqual({
        apiKey: "sk-test",
        language: "zh",
        theme: "dark"
    });
    expect(serializeConfig({ apiKey: "   " }, defaults)).toEqual({ language: "zh", theme: "dark" });
});

test("saveConfig and loadConfig round-trip the config data object", () => {
    const paths = configPaths(join(base, "round-trip"));

    saveConfig({ apiKey: "sk-test", language: "en", theme: "light" }, paths, defaults);
    expect(loadConfig(paths, defaults)).toEqual({ apiKey: "sk-test", language: "en", theme: "light" });

    saveConfig({}, paths, defaults);
    expect(loadConfig(paths, defaults)).toEqual({ language: "zh", theme: "dark" });
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
