import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, expect, test } from "vitest";
import {
    API_KEY_ENV,
    BASE_URL_ENV,
    createHeadlessConfig,
    HEADLESS_PROVIDER_ID,
    MODEL_ENV,
    parseHeadlessArguments,
    type HeadlessOptions
} from "./options.ts";

const base = mkdtempSync(join(tmpdir(), "jarvix-headless-"));
const EMPTY_ENV: Readonly<Record<string, string | undefined>> = {};

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
    expect(parseHeadlessArguments(["--prompt", "ignored"], base, EMPTY_ENV))
        .toEqual({ kind: "disabled" });
});

test("parses headless options and applies defaults", () => {
    const result = parseHeadlessArguments(REQUIRED, base, EMPTY_ENV);
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
    ], tmpdir(), EMPTY_ENV);

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
    expect(parseHeadlessArguments(["--headless", "--help"], base, EMPTY_ENV))
        .toEqual({ kind: "help" });
});

test("uses environment variables as fallback and prefers command-line values", () => {
    const result = parseHeadlessArguments([
        "--headless",
        "--prompt", "Use environment",
        "--api-key", "cli-secret"
    ], base, {
        [API_KEY_ENV]: "env-secret",
        [MODEL_ENV]: " env-model ",
        [BASE_URL_ENV]: " http://127.0.0.1:9000/v1 "
    });

    expect(result).toMatchObject({
        kind: "run",
        options: {
            apiKey: "cli-secret",
            model: "env-model",
            baseUrl: "http://127.0.0.1:9000/v1"
        }
    });
});

test("rejects missing, duplicate, and invalid options", () => {
    expect(() => parseHeadlessArguments(
        ["--headless", "--prompt", "hello"],
        base,
        EMPTY_ENV
    ))
        .toThrow(/Missing required option/);
    expect(() => parseHeadlessArguments([...REQUIRED, "--model", "other"], base, EMPTY_ENV))
        .toThrow(/Duplicate option/);
    expect(() => parseHeadlessArguments([
        ...REQUIRED,
        "--permission", "root"
    ], base, EMPTY_ENV)).toThrow(/Invalid --permission/);
    expect(() => parseHeadlessArguments([
        ...REQUIRED,
        "--api-protocol", "unknown"
    ], base, EMPTY_ENV)).toThrow(/Invalid --api-protocol/);
    expect(() => parseHeadlessArguments([
        ...REQUIRED,
        "--context-window", "1"
    ], base, EMPTY_ENV)).toThrow(/at least 2/);
    expect(() => parseHeadlessArguments([
        ...REQUIRED,
        "--cwd", join(base, "missing")
    ], base, EMPTY_ENV)).toThrow(/Working directory does not exist/);
});

test("builds a provider config from headless options", () => {
    const result = parseHeadlessArguments(REQUIRED, base, EMPTY_ENV);
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
