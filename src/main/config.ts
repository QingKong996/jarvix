import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
    DEFAULT_MODEL,
    REASONING_LEVELS,
    modelSelectionSchema,
    providerConfigSchema,
    resolveConfiguredModel,
    resolveReasoningLevel
} from "../protocol/providers.ts";
import {
    DEFAULT_THEME,
    SUPPORTED_LANGUAGES,
    SUPPORTED_THEMES,
    type JarvixConfig,
    type Language,
    type Theme
} from "../protocol/config.ts";

export type ConfigDefaults = {
    language: Language;
    theme: Theme;
};

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

/** The complete default config set. Fields that have no sensible default (e.g. apiKey) stay absent. */
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

export function loadConfig(paths: ConfigPaths = configPaths(), defaults: ConfigDefaults = systemDefaults()): JarvixConfig {
    try {
        return parseConfig(JSON.parse(readFileSync(paths.file, "utf8")), defaults);
    } catch {
        return parseConfig({}, defaults);
    }
}

export function saveConfig(
    config: JarvixConfig,
    paths: ConfigPaths = configPaths(),
    defaults: ConfigDefaults = systemDefaults()
): void {
    mkdirSync(dirname(paths.file), { recursive: true });
    const payload = serializeConfig(config, defaults);
    writeFileSync(paths.file, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function configSchema(defaults: ConfigDefaults) {
    return z
        .object({
            apiKey: z
                .string()
                .trim()
                .transform((value) => (value.length > 0 ? value : undefined))
                .optional(),
            providers: z.array(providerConfigSchema).refine(
                (providers) => new Set(providers.map((provider) => provider.id)).size === providers.length,
                "Duplicate provider IDs"
            ).optional(),
            selectedModel: modelSelectionSchema.optional(),
            reasoning: z.enum(REASONING_LEVELS).optional(),
            language: z.enum(SUPPORTED_LANGUAGES).catch(defaults.language),
            theme: z.enum(SUPPORTED_THEMES).catch(defaults.theme)
        })
        .superRefine((config, context) => {
            const selection = config.selectedModel;
            if (!selection) return;
            const provider = config.providers?.find((item) => item.id === selection.provider);
            if (provider?.models.some((model) => model.id === selection.id)) return;
            if (!provider && selection.provider === DEFAULT_MODEL.provider && selection.id === DEFAULT_MODEL.id) return;
            context.addIssue({ code: "custom", path: ["selectedModel"], message: "Selected model is not configured" });
        })
        .transform(({ apiKey, language, theme, providers, selectedModel, reasoning }) => {
            const resolved = resolveConfiguredModel(providers, selectedModel);
            const nextSelection = resolved?.selection ?? selectedModel;
            const nextReasoning = resolved || reasoning
                ? resolveReasoningLevel(resolved?.model, reasoning)
                : undefined;
            return {
                ...(apiKey ? { apiKey } : {}),
                ...(providers ? { providers } : {}),
                ...(nextSelection ? { selectedModel: nextSelection } : {}),
                ...(nextReasoning ? { reasoning: nextReasoning } : {}),
                language,
                theme
            };
        });
}

function detectLanguage(locale: string): Language {
    return locale.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function formatConfigError(error: z.ZodError): string {
    return error.issues
        .map((issue) => {
            const path = issue.path.map(String).join(".");
            return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
        })
        .join("; ");
}
