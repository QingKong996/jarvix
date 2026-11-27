import { z } from "zod";
import type {
    LlmToolCallBlock,
    LlmToolDefinition
} from "../../protocol/llm.ts";
import type { PermissionMode } from "../../protocol/permission.ts";
import type { Tool, ToolExecutionContext } from "./tool-manager.ts";
import type {
    DeferredToolDefinition,
    DeferredToolLoadResult,
    ToolExecutionResult
} from "./types.ts";
import { createGenericToolCallViewData } from "./tool-view.ts";

export const TOOL_SEARCH_TOOL = "tool_search";
export const LOAD_TOOL = "load_tool";
export const TOOL_SEARCH_RESULT_LIMIT = 16;
export const TOOL_DESCRIPTION_PREVIEW_CHARS = 1024;

const toolSearchArguments = z.object({
    query: z.string().trim().min(1),
    mode: z.enum(["fuzzy", "exact"]).optional(),
    limit: z.number().int().min(1).max(TOOL_SEARCH_RESULT_LIMIT).optional()
}).strict();

const loadToolArguments = z.object({
    name: z.string().trim().min(1)
}).strict();

export const DEFERRED_TOOL_DEFINITIONS: readonly LlmToolDefinition[] = [
    {
        name: TOOL_SEARCH_TOOL,
        description: [
            "Search deferred tools by tool name and description, similar to grep.",
            "mode=fuzzy (default) returns matching names with descriptions truncated to 1024 characters.",
            "mode=exact returns the complete tool spec for an exact tool name.",
            `Call ${LOAD_TOOL} with a returned name to make that tool available.`
        ].join(" "),
        parameters: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "Case-insensitive text to find in deferred tool names or descriptions."
                },
                mode: {
                    type: "string",
                    enum: ["fuzzy", "exact"],
                    description: "Use fuzzy for grep-like discovery or exact for complete specs.",
                    default: "fuzzy"
                },
                limit: {
                    type: "integer",
                    minimum: 1,
                    maximum: TOOL_SEARCH_RESULT_LIMIT,
                    description: `Maximum fuzzy results to return. Defaults to ${TOOL_SEARCH_RESULT_LIMIT}.`
                }
            },
            required: ["query"],
            additionalProperties: false
        }
    },
    {
        name: LOAD_TOOL,
        description: [
            "Load one deferred tool by its exact name.",
            "The loaded tool becomes callable on the next model call."
        ].join(" "),
        parameters: {
            type: "object",
            properties: {
                name: {
                    type: "string",
                    description: `Exact name returned by ${TOOL_SEARCH_TOOL}.`
                }
            },
            required: ["name"],
            additionalProperties: false
        }
    }
];

export type DeferredToolHost = {
    deferredTools(): readonly DeferredToolDefinition[];
    loadDeferredTool(name: string): DeferredToolLoadResult;
};

/** Exposes search and load tools for deferred definitions contributed by other tools. */
export class DeferredToolLoader implements Tool {
    readonly definitions = DEFERRED_TOOL_DEFINITIONS;
    private readonly host: DeferredToolHost;

    constructor(host: DeferredToolHost) {
        this.host = host;
    }

    getRegisteredTools(_permission: PermissionMode): readonly LlmToolDefinition[] {
        return this.host.deferredTools().length > 0 ? this.definitions : [];
    }

    async execute(
        call: LlmToolCallBlock,
        _context: ToolExecutionContext
    ): Promise<ToolExecutionResult> {
        switch (call.name) {
            case TOOL_SEARCH_TOOL:
                return this.search(call);
            case LOAD_TOOL:
                return this.load(call);
            default:
                return toolResult(call, `Unknown tool: ${call.name}`, true);
        }
    }

    private search(call: LlmToolCallBlock): ToolExecutionResult {
        const parsed = toolSearchArguments.safeParse(call.arguments);
        if (!parsed.success) {
            return toolResult(call, invalidArguments(call.name, parsed.error), true);
        }
        const mode = parsed.data.mode ?? "fuzzy";
        const limit = parsed.data.limit ?? TOOL_SEARCH_RESULT_LIMIT;
        const tools = this.host.deferredTools();
        if (mode === "fuzzy") {
            return toolResult(call, JSON.stringify({
                mode,
                query: parsed.data.query,
                tools: fuzzyDeferredToolMatches(tools, parsed.data.query, limit)
            }, null, 2));
        }
        const matches = exactDeferredToolMatches(tools, parsed.data.query)
            .slice(0, limit)
            .map(exactDeferredToolMatch);
        return toolResult(call, JSON.stringify({
            mode,
            query: parsed.data.query,
            tools: matches,
            ...(matches.length === 0 ? { message: "No deferred tool has that exact name." } : {})
        }, null, 2));
    }

    private load(call: LlmToolCallBlock): ToolExecutionResult {
        const parsed = loadToolArguments.safeParse(call.arguments);
        if (!parsed.success) {
            return toolResult(call, invalidArguments(call.name, parsed.error), true);
        }
        const matches = exactDeferredToolMatches(
            this.host.deferredTools(),
            parsed.data.name
        );
        if (matches.length === 0) {
            return toolResult(call, `Unknown deferred tool: ${parsed.data.name}`, true);
        }
        if (matches.length > 1) {
            return toolResult(
                call,
                [
                    `Deferred tool name is ambiguous: ${parsed.data.name}`,
                    "Use one of these exact names:",
                    ...matches.map((tool) => `- ${tool.definition.name}`)
                ].join("\n"),
                true
            );
        }

        const name = matches[0]!.definition.name;
        const result = this.host.loadDeferredTool(name);
        switch (result) {
            case "loaded":
                return toolResult(
                    call,
                    `Loaded tool ${name}. It is available on the next model call.`
                );
            case "already-loaded":
                return toolResult(call, `Tool is already loaded: ${name}`);
            case "unknown":
                return toolResult(call, `Unknown deferred tool: ${name}`, true);
            case "failed":
                return toolResult(call, `Tool could not be loaded: ${name}`, true);
        }
    }
}

export function fuzzyDeferredToolMatches(
    tools: readonly DeferredToolDefinition[],
    query: string,
    limit = TOOL_SEARCH_RESULT_LIMIT
): readonly {
    name: string;
    description: string;
    [key: string]: string | number | boolean;
}[] {
    const normalized = query.trim().toLowerCase();
    if (normalized.length === 0) {
        return [];
    }
    return tools
        .filter((tool) => matchesToolQuery(tool, normalized))
        .slice(0, normalizeLimit(limit))
        .map((tool) => ({
            ...tool.searchMetadata,
            name: tool.definition.name,
            description: previewDescription(tool.definition.description)
        }));
}

export function exactDeferredToolMatches(
    tools: readonly DeferredToolDefinition[],
    name: string
): readonly DeferredToolDefinition[] {
    const query = name.trim();
    if (query.length === 0) {
        return [];
    }
    return tools.filter((tool) => (
        tool.definition.name === query
        || tool.aliases?.includes(query) === true
    ));
}

export function exactDeferredToolMatch(
    tool: DeferredToolDefinition
): Readonly<Record<string, unknown>> {
    return {
        ...tool.exactMetadata,
        name: tool.definition.name,
        description: tool.definition.description,
        parameters: tool.definition.parameters
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
    tool: DeferredToolDefinition,
    normalizedQuery: string
): boolean {
    const haystack = [
        tool.definition.name,
        tool.definition.description,
        ...(tool.aliases ?? []),
        ...Object.values(tool.searchMetadata ?? {})
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

function toolResult(
    call: LlmToolCallBlock,
    output: string,
    isError = false
): ToolExecutionResult {
    return {
        content: output,
        data: {
            ...createGenericToolCallViewData(
                call.name,
                call.arguments,
                isError ? "failed" : "completed"
            ),
            output
        },
        isError,
        endReason: "exited"
    };
}

function invalidArguments(
    toolName: string,
    error: z.ZodError
): string {
    return `Invalid arguments for ${toolName}: ${error.message}`;
}
