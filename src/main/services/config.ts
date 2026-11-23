import { randomUUID } from "node:crypto";
import {
    closeSync,
    fstatSync,
    mkdirSync,
    openSync,
    readSync,
    renameSync,
    unlinkSync,
    writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { type JarvixLogger, noopLogger } from "../../core/logger.ts";
import {
    REASONING_LEVELS,
    modelSelectionSchema,
    providerConfigSchema,
    resolveConfiguredModel,
    resolveReasoningLevel
} from "../../protocol/providers.ts";
import {
    DEFAULT_THEME,
    SUPPORTED_LANGUAGES,
    SUPPORTED_THEMES,
    type JarvixConfig,
    type Language,
    type Theme
} from "../../protocol/config.ts";

export type ConfigDefaults = {
    language: Language;
    theme: Theme;
};

const CONFIG_DIRECTORY_NAME = ".jarvix";
const CONFIG_FILE_NAME = "config.json";
const MAX_CONFIG_FILE_BYTES = 1024 * 1024;

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

/** The complete default config set. Fields that have no sensible default stay absent. */
export function systemDefaults(locale = Intl.DateTimeFormat().resolvedOptions().locale): ConfigDefaults {
    return {
        language: detectLanguage(locale),
        theme: DEFAULT_THEME
    };
}

export function parseConfig(value: unknown, defaults: ConfigDefaults = systemDefaults()): JarvixConfig {
    const parsed = configSchema(defaults).safeParse(value);
    if (!parsed.success) {
        throw new Error(`Invalid config: ${formatConfigError(parsed.error)}`);
    }
    return parsed.data;
}

export function serializeConfig(config: JarvixConfig, defaults: ConfigDefaults = systemDefaults()): JarvixConfig {
    return configSchema(defaults).parse(config);
}

export function loadConfig(
    paths: ConfigPaths = configPaths(),
    defaults: ConfigDefaults = systemDefaults(),
    logger: JarvixLogger = noopLogger
): JarvixConfig {
    try {
        return parseConfig(JSON.parse(readConfigFile(paths.file)), defaults);
    } catch (error) {
        const code = errorCode(error);
        if (code === "ENOENT") {
            logger.debug("Config file does not exist; using defaults", {
                file: paths.file
            });
        } else {
            logger.warn("Failed to load config; using defaults", {
                file: paths.file,
                reason: error instanceof Error ? error.message : String(error)
            });
        }
        return parseConfig({}, defaults);
    }
}

function readConfigFile(file: string): string {
    const descriptor = openSync(file, "r");
    try {
        const stats = fstatSync(descriptor);
        if (!stats.isFile() || stats.size > MAX_CONFIG_FILE_BYTES) {
            throw new Error("Config file exceeds the safe size limit");
        }
        const buffer = Buffer.alloc(stats.size);
        const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0);
        if (bytesRead !== stats.size) {
            throw new Error("Config file changed while being read");
        }
        return buffer.toString("utf8");
    } finally {
        closeSync(descriptor);
    }
}

export function saveConfig(
    config: JarvixConfig,
    paths: ConfigPaths = configPaths(),
    defaults: ConfigDefaults = systemDefaults()
): void {
    const payload = serializeConfig(config, defaults);
    const contents = `${JSON.stringify(payload, null, 2)}\n`;
    if (Buffer.byteLength(contents, "utf8") > MAX_CONFIG_FILE_BYTES) {
        throw new Error(
            `Config file exceeds the safe size limit of ${MAX_CONFIG_FILE_BYTES} bytes`
        );
    }
    mkdirSync(dirname(paths.file), { recursive: true });
    const temporary = `${paths.file}.${process.pid}.${randomUUID()}.tmp`;
    try {
        writeFileSync(temporary, contents, {
            encoding: "utf8",
            mode: 0o600
        });
        renameSync(temporary, paths.file);
    } catch (error) {
        try {
            unlinkSync(temporary);
        } catch {
            // The temporary file may not have been created.
        }
        throw error;
    }
}

function configSchema(defaults: ConfigDefaults) {
    return z
        .object({
            providers: z.array(providerConfigSchema).refine(
                (providers) => new Set(providers.map((provider) => provider.id)).size === providers.length,
                "Duplicate provider IDs"
            ).optional(),
            selectedModel: modelSelectionSchema.optional(),
            reasoning: z.enum(REASONING_LEVELS).optional(),
            language: z.enum(SUPPORTED_LANGUAGES).catch(defaults.language),
            theme: z.enum(SUPPORTED_THEMES).catch(defaults.theme),
            contextCompactionThreshold: z.number().int().positive().optional()
        })
        .superRefine((config, context) => {
            const selection = config.selectedModel;
            if (!selection) return;
            const provider = config.providers?.find((item) => item.id === selection.provider);
            if (provider?.models.some((model) => model.id === selection.id)) return;
            context.addIssue({ code: "custom", path: ["selectedModel"], message: "Selected model is not configured" });
        })
        .transform(({
            language,
            theme,
            providers,
            selectedModel,
            reasoning,
            contextCompactionThreshold
        }) => {
            const resolved = resolveConfiguredModel(providers, selectedModel);
            const nextSelection = resolved?.selection ?? selectedModel;
            const nextReasoning = resolved || reasoning
                ? resolveReasoningLevel(resolved?.model, reasoning)
                : undefined;
            return {
                ...(providers ? { providers } : {}),
                ...(nextSelection ? { selectedModel: nextSelection } : {}),
                ...(nextReasoning ? { reasoning: nextReasoning } : {}),
                ...(contextCompactionThreshold !== undefined
                    ? { contextCompactionThreshold }
                    : {}),
                language,
                theme
            };
        });
}

function detectLanguage(locale: string): Language {
    return locale.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function errorCode(error: unknown): string | undefined {
    if (typeof error !== "object" || error === null || !("code" in error)) {
        return undefined;
    }
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
}

function formatConfigError(error: z.ZodError): string {
    return error.issues
        .map((issue) => {
            const path = issue.path.map(String).join(".");
            return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
        })
        .join("; ");
}
