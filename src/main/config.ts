import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { SUPPORTED_LANGUAGES, type JarvixConfig } from "../protocol/config.ts";

const configSchema: z.ZodType<JarvixConfig> = z
    .object({
        apiKey: z
            .string()
            .trim()
            .transform((value) => (value.length > 0 ? value : undefined))
            .optional(),
        language: z.enum(SUPPORTED_LANGUAGES).optional()
    })
    .transform(({ apiKey, language }) => ({
        ...(apiKey ? { apiKey } : {}),
        ...(language ? { language } : {})
    }));

const CONFIG_DIRECTORY_NAME = ".jarvix";
const CONFIG_FILE_NAME = "config.json";

export type ConfigPaths = {
    directory: string;
    file: string;
};

export function configPaths(directory = join(homedir(), CONFIG_DIRECTORY_NAME)): ConfigPaths {
    return {
        directory,
        file: join(directory, CONFIG_FILE_NAME)
    };
}

export function parseConfig(value: unknown): JarvixConfig {
    const parsed = configSchema.safeParse(value);
    if (!parsed.success) {
        throw new Error(`Invalid config: ${formatConfigError(parsed.error)}`);
    }
    return parsed.data;
}

export function serializeConfig(config: JarvixConfig): JarvixConfig {
    return configSchema.parse(config);
}

export function loadConfig(paths: ConfigPaths = configPaths()): JarvixConfig {
    try {
        return parseConfig(JSON.parse(readFileSync(paths.file, "utf8")));
    } catch {
        return {};
    }
}

export function saveConfig(config: JarvixConfig, paths: ConfigPaths = configPaths()): void {
    mkdirSync(dirname(paths.file), { recursive: true });
    const payload = serializeConfig(config);
    writeFileSync(paths.file, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function formatConfigError(error: z.ZodError): string {
    return error.issues
        .map((issue) => {
            const path = issue.path.map(String).join(".");
            return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
        })
        .join("; ");
}
