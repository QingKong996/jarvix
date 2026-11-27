import type { McpCatalogTool } from "../../../mcp/runtime.ts";

export const TOOL_SEARCH_RESULT_LIMIT = 16;
export const TOOL_DESCRIPTION_PREVIEW_CHARS = 1024;

export type McpToolSearchMode = "fuzzy" | "exact";

export type FuzzyToolMatch = {
    name: string;
    server: string;
    toolName: string;
    description: string;
};

export type ExactToolMatch = {
    name: string;
    server: string;
    toolName: string;
    [key: string]: unknown;
};

export function fuzzyToolMatches(
    tools: readonly McpCatalogTool[],
    query: string,
    limit = TOOL_SEARCH_RESULT_LIMIT
): FuzzyToolMatch[] {
    const normalized = query.trim().toLowerCase();
    if (normalized.length === 0) {
        return [];
    }
    return tools
        .filter((tool) => matchesToolQuery(tool, normalized))
        .slice(0, normalizeLimit(limit))
        .map((tool) => ({
            name: tool.exposedName,
            server: tool.server,
            toolName: tool.toolName,
            description: previewDescription(tool.description)
        }));
}

export function exactToolMatch(tool: McpCatalogTool): ExactToolMatch {
    const { name: _name, ...spec } = tool.spec;
    return {
        name: tool.exposedName,
        server: tool.server,
        toolName: tool.toolName,
        spec: tool.spec,
        ...spec
    };
}

export function previewDescription(description: string): string {
    const characters = Array.from(description);
    if (characters.length <= TOOL_DESCRIPTION_PREVIEW_CHARS) {
        return description;
    }
    const remaining = characters.length - TOOL_DESCRIPTION_PREVIEW_CHARS;
    return [
        characters.slice(0, TOOL_DESCRIPTION_PREVIEW_CHARS).join(""),
        `...[truncated, ${remaining} characters remaining]`
    ].join("\n");
}

function matchesToolQuery(
    tool: McpCatalogTool,
    normalizedQuery: string
): boolean {
    const haystack = [
        tool.exposedName,
        tool.server,
        tool.toolName,
        tool.description
    ].join("\n").toLowerCase();
    if (haystack.includes(normalizedQuery)) {
        return true;
    }
    const terms = normalizedQuery.split(/\s+/).filter(Boolean);
    return terms.length > 1 && terms.every((term) => haystack.includes(term));
}

function normalizeLimit(limit: number): number {
    if (!Number.isFinite(limit)) {
        return TOOL_SEARCH_RESULT_LIMIT;
    }
    return Math.max(1, Math.min(TOOL_SEARCH_RESULT_LIMIT, Math.trunc(limit)));
}
