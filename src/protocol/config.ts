import type { JarvixSkillSettings } from "./skill.ts";

import type { ModelSelection, ProviderConfig, ReasoningLevel } from "./providers.ts";

export const MCP_SERVER_TRANSPORTS = ["stdio", "http", "sse"] as const;

export type McpServerTransport = (typeof MCP_SERVER_TRANSPORTS)[number];

/** One MCP server configured by the user. */
export type JarvixMcpServerConfig = {
    transport?: McpServerTransport;
    enabled?: boolean;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    url?: string;
    headers?: Record<string, string>;
};

export const SUPPORTED_LANGUAGES = ["zh", "en"] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const SUPPORTED_THEMES = ["dark", "light"] as const;

export type Theme = (typeof SUPPORTED_THEMES)[number];

export const DEFAULT_THEME: Theme = "light";

/** Config data object shared across IPC, the core runtime and the main-process store. */
export type JarvixConfig = {
    providers?: ProviderConfig[];
    selectedModel?: ModelSelection;
    reasoning?: ReasoningLevel;
    language?: Language;
    theme?: Theme;
    /** Remaining context headroom in tokens that triggers local compaction. */
    contextCompactionThreshold?: number;
    /** Per-skill overrides keyed by the absolute SKILL.md path. */
    skills?: JarvixSkillSettings;
    /** MCP servers keyed by the name exposed to the model. */
    mcpServers?: Record<string, JarvixMcpServerConfig>;
};
