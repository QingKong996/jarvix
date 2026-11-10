import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { configPaths, loadConfig, parseConfig, saveConfig, serializeConfig } from "./config.ts";

const base = mkdtempSync(join(tmpdir(), "jarvix-config-"));

afterAll(() => {
    rmSync(base, { recursive: true, force: true });
});

test("parseConfig trims the apiKey", () => {
    expect(parseConfig({ apiKey: "  sk-test  " })).toEqual({ apiKey: "sk-test" });
});

test("parseConfig normalizes a missing or blank apiKey to an empty config", () => {
    expect(parseConfig({})).toEqual({});
    expect(parseConfig({ apiKey: "   " })).toEqual({});
});

test("parseConfig drops unknown fields", () => {
    expect(parseConfig({ apiKey: "sk-test", model: "deepseek" })).toEqual({ apiKey: "sk-test" });
});

test("parseConfig accepts a supported language", () => {
    expect(parseConfig({ apiKey: "sk-test", language: "en" })).toEqual({ apiKey: "sk-test", language: "en" });
});

test("parseConfig rejects an unsupported language", () => {
    expect(() => parseConfig({ language: "fr" })).toThrow(/Invalid config: language/);
});

test("parseConfig accepts a supported theme", () => {
    expect(parseConfig({ theme: "light" })).toEqual({ theme: "light" });
});

test("parseConfig rejects an unsupported theme", () => {
    expect(() => parseConfig({ theme: "system" })).toThrow(/Invalid config: theme/);
});

test("parseConfig rejects data that is not an object", () => {
    expect(() => parseConfig(null)).toThrow(/Invalid config/);
    expect(() => parseConfig("sk-test")).toThrow(/Invalid config/);
    expect(() => parseConfig([])).toThrow(/Invalid config/);
    expect(() => parseConfig(undefined)).toThrow(/Invalid config/);
});

test("parseConfig rejects a non-string apiKey", () => {
    expect(() => parseConfig({ apiKey: 42 })).toThrow(/Invalid config: apiKey/);
    expect(() => parseConfig({ apiKey: null })).toThrow(/Invalid config: apiKey/);
});

test("serializeConfig omits an unset apiKey", () => {
    expect(serializeConfig({})).toEqual({});
    expect(serializeConfig({ apiKey: "sk-test" })).toEqual({ apiKey: "sk-test" });
    expect(serializeConfig({ apiKey: "   " })).toEqual({});
});

test("saveConfig and loadConfig round-trip the config data object", () => {
    const paths = configPaths(join(base, "round-trip"));

    saveConfig({ apiKey: "sk-test", language: "en", theme: "light" }, paths);
    expect(loadConfig(paths)).toEqual({ apiKey: "sk-test", language: "en", theme: "light" });

    saveConfig({}, paths);
    expect(loadConfig(paths)).toEqual({});
});

test("loadConfig falls back to an empty config when the file is unreadable", () => {
    const paths = configPaths(join(base, "corrupt"));
    mkdirSync(paths.directory, { recursive: true });
    writeFileSync(paths.file, "{not json", "utf8");

    expect(loadConfig(paths)).toEqual({});
});

test("loadConfig falls back to an empty config when the content is invalid", () => {
    const paths = configPaths(join(base, "invalid"));
    mkdirSync(paths.directory, { recursive: true });
    writeFileSync(paths.file, JSON.stringify({ apiKey: 42 }), "utf8");

    expect(loadConfig(paths)).toEqual({});
});
