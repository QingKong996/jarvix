import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, expect, test } from "vitest";
import {
    createHeadlessConfig,
    HEADLESS_PROVIDER_ID,
    parseHeadlessArguments,
    type HeadlessOptions
} from "./options.ts";

const base = mkdtempSync(join(tmpdir(), "jarvix-headless-"));

const REQUIRED = [
    "--headless",
    "--prompt", "Explain the repository",
    "--api-key", "secret",
    "--model", "test-model",
    "--base-url", "http://127.0.0.1:8080/v1"
] as const;

afterAll(() => {
    rmSync(base, { recursive: true, force: true });
});

test("ignores arguments when headless mode is not requested", () => {
    expect(parseHeadlessArguments(["--prompt", "ignored"], base))
        .toEqual({ kind: "disabled" });
});

test("parses headless options and applies defaults", () => {
    const result = parseHeadlessArguments(REQUIRED, base);
    expect(result).toMatchObject({
        kind: "run",
        options: {
            prompt: "Explain the repository",
            apiKey: "secret",
            model: "test-model",
            contextWindow: 32_768,
            baseUrl: "http://127.0.0.1:8080/v1",
            protocol: "openai-completions",
            workingDirectory: resolve(base),
            permission: "read-only"
        }
    });
});

test("accepts aliases, inline values, and explicit execution settings", () => {
    const result = parseHeadlessArguments([
        "--headless",
        "-p=Run tests",
        "--key=secret",
        "--model=test-model",
        "--base-url=http://127.0.0.1:8080/v1",
        "--protocol=anthropic-messages",
        "--context-window=64000",
        "-C", base,
        "--permission=project-read-write"
    ], tmpdir());

    expect(result).toMatchObject({
        kind: "run",
        options: {
            prompt: "Run tests",
            protocol: "anthropic-messages",
            contextWindow: 64_000,
            workingDirectory: resolve(base),
            permission: "project-read-write"
        }
    });
});

test("returns help without requiring connection settings", () => {
    expect(parseHeadlessArguments(["--headless", "--help"], base))
        .toEqual({ kind: "help" });
});

test("rejects missing, duplicate, and invalid options", () => {
    expect(() => parseHeadlessArguments(["--headless", "--prompt", "hello"], base))
        .toThrow(/Missing required option/);
    expect(() => parseHeadlessArguments([...REQUIRED, "--model", "other"], base))
        .toThrow(/Duplicate option/);
    expect(() => parseHeadlessArguments([
        ...REQUIRED,
        "--permission", "root"
    ], base)).toThrow(/Invalid --permission/);
    expect(() => parseHeadlessArguments([
        ...REQUIRED,
        "--api-protocol", "unknown"
    ], base)).toThrow(/Invalid --api-protocol/);
    expect(() => parseHeadlessArguments([
        ...REQUIRED,
        "--context-window", "1"
    ], base)).toThrow(/at least 2/);
    expect(() => parseHeadlessArguments([
        ...REQUIRED,
        "--cwd", join(base, "missing")
    ], base)).toThrow(/Working directory does not exist/);
});

test("builds a provider config from headless options", () => {
    const result = parseHeadlessArguments(REQUIRED, base);
    if (result.kind !== "run") {
        throw new Error("Expected headless options");
    }
    const options: HeadlessOptions = {
        ...result.options,
        contextWindow: 8_192
    };
    const config = createHeadlessConfig(options);

    expect(config.selectedModel).toEqual({
        provider: HEADLESS_PROVIDER_ID,
        id: "test-model"
    });
    expect(config.providers?.[0]).toMatchObject({
        id: HEADLESS_PROVIDER_ID,
        protocol: "openai-completions",
        baseUrl: "http://127.0.0.1:8080/v1",
        apiKey: "secret",
        models: [{
            id: "test-model",
            contextWindow: 8_192,
            maxTokens: 4_096,
            toolCall: true
        }]
    });
});
