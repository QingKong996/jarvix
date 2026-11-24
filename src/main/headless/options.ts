import { statSync } from "node:fs";
import { resolve } from "node:path";
import type { JarvixConfig } from "../../protocol/config.ts";
import {
    DEFAULT_PERMISSION_MODE,
    PERMISSION_MODES,
    type PermissionMode
} from "../../protocol/permission.ts";
import {
    PROVIDER_PROTOCOLS,
    providerConfigSchema,
    type ProviderProtocol
} from "../../protocol/providers.ts";

export const HEADLESS_FLAG = "--headless";
export const HEADLESS_PROVIDER_ID = "headless";

const DEFAULT_CONTEXT_WINDOW = 32_768;
const DEFAULT_MAX_TOKENS = 4_096;
const DEFAULT_PROTOCOL: ProviderProtocol = "openai-completions";

export type HeadlessOptions = {
    prompt: string;
    apiKey: string;
    model: string;
    contextWindow: number;
    baseUrl: string;
    protocol: ProviderProtocol;
    workingDirectory: string;
    permission: PermissionMode;
};

export type HeadlessInvocation =
    | { kind: "disabled" }
    | { kind: "help" }
    | { kind: "run"; options: HeadlessOptions };

type OptionName =
    | "prompt"
    | "apiKey"
    | "model"
    | "contextWindow"
    | "baseUrl"
    | "protocol"
    | "workingDirectory"
    | "permission"
    | "help";

const OPTION_NAMES = {
    "--prompt": "prompt",
    "-p": "prompt",
    "--api-key": "apiKey",
    "--key": "apiKey",
    "--model": "model",
    "--context-window": "contextWindow",
    "--base-url": "baseUrl",
    "--api-protocol": "protocol",
    "--protocol": "protocol",
    "--cwd": "workingDirectory",
    "--workdir": "workingDirectory",
    "--working-directory": "workingDirectory",
    "-C": "workingDirectory",
    "--permission": "permission",
    "--permission-mode": "permission",
    "--access": "permission",
    "--help": "help",
    "-h": "help"
} as const satisfies Record<string, OptionName>;

export const HEADLESS_HELP = `Usage:
  Jarvix --headless --prompt <text> --api-key <key> --model <id> [options] --base-url <url>

Options:
  -p, --prompt <text>          Prompt to run once, then exit
      --api-key <key>          Provider API key
      --model <id>             Provider model id
      --context-window <n>     Model context window in tokens (default: ${DEFAULT_CONTEXT_WINDOW})
      --api-protocol <name>    Provider protocol (default: ${DEFAULT_PROTOCOL})
  -C, --cwd <path>             Working directory (default: current directory)
      --permission <mode>      ${PERMISSION_MODES.join(", ")} (default: ${DEFAULT_PERMISSION_MODE})
      --base-url <url>         Provider base URL
  -h, --help                   Show this help

On Windows, use --base-url=<url> when other options follow the URL.

Supported protocols:
  ${PROVIDER_PROTOCOLS.join(", ")}

Only one prompt is accepted. The final assistant response is written to stdout.
`;

export class HeadlessUsageError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "HeadlessUsageError";
    }
}

export function parseHeadlessArguments(
    argv: readonly string[],
    cwd = process.cwd()
): HeadlessInvocation {
    if (!argv.includes(HEADLESS_FLAG)) {
        return { kind: "disabled" };
    }

    const values = new Map<OptionName, string>();
    let help = false;
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index]!;
        if (argument === HEADLESS_FLAG) {
            continue;
        }
        if (!argument.startsWith("-")) {
            throw new HeadlessUsageError(`Unexpected argument: ${argument}`);
        }

        const separator = argument.indexOf("=");
        const option = separator === -1 ? argument : argument.slice(0, separator);
        const inlineValue = separator === -1 ? undefined : argument.slice(separator + 1);
        if (option === HEADLESS_FLAG) {
            throw new HeadlessUsageError(`${HEADLESS_FLAG} does not accept a value`);
        }
        const name = OPTION_NAMES[option as keyof typeof OPTION_NAMES];
        if (!name) {
            throw new HeadlessUsageError(`Unknown option: ${option}`);
        }
        if (name === "help") {
            if (inlineValue !== undefined) {
                throw new HeadlessUsageError(`${option} does not accept a value`);
            }
            help = true;
            continue;
        }

        const value = inlineValue ?? argv[index + 1];
        if (value === undefined) {
            throw new HeadlessUsageError(`Missing value for ${option}`);
        }
        if (inlineValue === undefined) {
            index += 1;
        }
        if (value.trim().length === 0) {
            throw new HeadlessUsageError(`Missing value for ${option}`);
        }
        if (values.has(name)) {
            throw new HeadlessUsageError(`Duplicate option: ${option}`);
        }
        values.set(name, value.trim());
    }

    if (help) {
        return { kind: "help" };
    }

    const contextWindow = parseContextWindow(values.get("contextWindow"));
    const protocol = values.get("protocol") ?? DEFAULT_PROTOCOL;
    if (!isProviderProtocol(protocol)) {
        throw new HeadlessUsageError(
            `Invalid --api-protocol: ${protocol}. Expected one of: ${PROVIDER_PROTOCOLS.join(", ")}`
        );
    }
    const permission = values.get("permission") ?? DEFAULT_PERMISSION_MODE;
    if (!isPermissionMode(permission)) {
        throw new HeadlessUsageError(
            `Invalid --permission: ${permission}. Expected one of: ${PERMISSION_MODES.join(", ")}`
        );
    }
    const workingDirectory = resolve(cwd, values.get("workingDirectory") ?? ".");
    assertWorkingDirectory(workingDirectory);

    return {
        kind: "run",
        options: {
            prompt: requireOption(values, "prompt", "--prompt"),
            apiKey: requireOption(values, "apiKey", "--api-key"),
            model: requireOption(values, "model", "--model"),
            contextWindow,
            baseUrl: requireOption(values, "baseUrl", "--base-url"),
            protocol,
            workingDirectory,
            permission
        }
    };
}

export function createHeadlessConfig(options: HeadlessOptions): JarvixConfig {
    try {
        const provider = providerConfigSchema.parse({
            id: HEADLESS_PROVIDER_ID,
            name: "Headless",
            protocol: options.protocol,
            baseUrl: options.baseUrl,
            apiKey: options.apiKey,
            models: [{
                id: options.model,
                name: options.model,
                contextWindow: options.contextWindow,
                maxTokens: Math.min(DEFAULT_MAX_TOKENS, options.contextWindow - 1),
                toolCall: true
            }]
        });
        const model = provider.models[0]!;
        return {
            providers: [provider],
            selectedModel: {
                provider: provider.id,
                id: model.id
            }
        };
    } catch (error) {
        throw new HeadlessUsageError(
            `Invalid provider configuration: ${errorMessage(error)}`
        );
    }
}

function requireOption(
    values: ReadonlyMap<OptionName, string>,
    name: OptionName,
    option: string
): string {
    const value = values.get(name);
    if (!value) {
        throw new HeadlessUsageError(`Missing required option: ${option}`);
    }
    return value;
}

function parseContextWindow(value: string | undefined): number {
    if (value === undefined) {
        return DEFAULT_CONTEXT_WINDOW;
    }
    if (!/^\d+$/.test(value)) {
        throw new HeadlessUsageError("--context-window must be an integer");
    }
    const contextWindow = Number(value);
    if (!Number.isSafeInteger(contextWindow) || contextWindow < 2) {
        throw new HeadlessUsageError("--context-window must be at least 2");
    }
    return contextWindow;
}

function assertWorkingDirectory(path: string): void {
    try {
        if (!statSync(path).isDirectory()) {
            throw new HeadlessUsageError(`Working directory is not a directory: ${path}`);
        }
    } catch (error) {
        if (error instanceof HeadlessUsageError) {
            throw error;
        }
        throw new HeadlessUsageError(
            `Working directory does not exist: ${path}`
        );
    }
}

function isProviderProtocol(value: string): value is ProviderProtocol {
    return (PROVIDER_PROTOCOLS as readonly string[]).includes(value);
}

function isPermissionMode(value: string): value is PermissionMode {
    return (PERMISSION_MODES as readonly string[]).includes(value);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
