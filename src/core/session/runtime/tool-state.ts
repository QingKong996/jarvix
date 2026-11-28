import type {
    LlmSystemMessage,
    LlmToolDefinition
} from "../../../protocol/llm.ts";
import {
    CONTEXT_SNAPSHOT_KEYS,
    injectedContextMessage,
    type ContextInjection,
    type ContextSnapshotSource
} from "./context-injection.ts";

export type RunToolState = {
    readonly base: readonly LlmToolDefinition[];
    current: readonly LlmToolDefinition[];
    readonly changes: LlmSystemMessage[];
};

export function createRunToolState(
    tools: readonly LlmToolDefinition[]
): RunToolState {
    return {
        base: tools,
        current: tools,
        changes: []
    };
}

export function syncRunToolState(
    state: RunToolState,
    current: readonly LlmToolDefinition[]
): boolean {
    const change = toolSetChange(state.current, current);
    if (!change) {
        return false;
    }
    state.changes.push(injectedContextMessage(toolChangeInjection(change)));
    state.current = current;
    return true;
}

export function mcpToolDefinitionsFingerprint(
    tools: readonly LlmToolDefinition[]
): string {
    return stableJson(
        mcpTools(tools)
            .sort((left, right) => left.name.localeCompare(right.name))
            .map(normalizedDefinition)
    );
}

export function mcpToolSnapshotSource(
    tools: readonly LlmToolDefinition[]
): ContextSnapshotSource {
    const current = mcpTools(tools);
    return {
        key: CONTEXT_SNAPSHOT_KEYS.mcp,
        fingerprint: mcpToolDefinitionsFingerprint(tools),
        change: (previousFingerprint) => {
            const previous = parseDefinitions(previousFingerprint);
            if (!previous) {
                return [];
            }
            return mcpToolChanges(previous, current)
                .map(mcpToolChangeInjection);
        }
    };
}

function mcpTools(
    tools: readonly LlmToolDefinition[]
): LlmToolDefinition[] {
    return tools.filter((tool) => (
        tool.name.startsWith("mcp__")
        || tool.name === "list_mcp_resources"
        || tool.name === "list_mcp_resource_templates"
        || tool.name === "read_mcp_resource"
    ));
}

type ToolSetChange = {
    added: readonly LlmToolDefinition[];
    removed: readonly { name: string }[];
    updated: readonly string[];
};

function toolSetChange(
    previousTools: readonly LlmToolDefinition[],
    currentTools: readonly LlmToolDefinition[]
): ToolSetChange | null {
    const previous = new Map(previousTools.map((tool) => [tool.name, tool]));
    const next = new Map(currentTools.map((tool) => [tool.name, tool]));
    const added = currentTools.filter((tool) => {
        const prior = previous.get(tool.name);
        return !prior || definitionKey(prior) !== definitionKey(tool);
    });
    const removed = previousTools
        .filter((tool) => {
            const replacement = next.get(tool.name);
            return !replacement || definitionKey(replacement) !== definitionKey(tool);
        })
        .map((tool) => ({ name: tool.name }));
    const updated = currentTools
        .filter((tool) => {
            const prior = previous.get(tool.name);
            return prior !== undefined
                && definitionKey(prior) !== definitionKey(tool);
        })
        .map((tool) => tool.name);

    if (added.length === 0 && removed.length === 0) {
        return null;
    }
    return { added, removed, updated };
}

function toolChangeInjection(change: ToolSetChange): ContextInjection {
    return {
        declaration: [
            "The available tools changed. Use only the current tool",
            "definitions."
        ].join(" "),
        content: toolChangeContent(change),
        ...(change.added.length > 0
            ? { toolsAdded: [...change.added] }
            : {}),
        ...(change.removed.length > 0
            ? { toolsRemoved: change.removed.map((tool) => ({ ...tool })) }
            : {})
    };
}

function toolChangeContent(change: ToolSetChange): string {
    const added = change.added
        .filter((tool) => !change.updated.includes(tool.name))
        .map((tool) => tool.name);
    const removed = change.removed
        .filter((tool) => !change.updated.includes(tool.name))
        .map((tool) => tool.name);
    return [
        ...(added.length > 0
            ? [
                "Added tools:",
                ...added.map((name) => `- ${name}`)
            ]
            : []),
        ...(removed.length > 0
            ? [
                "Removed tools:",
                ...removed.map((name) => `- ${name}`)
            ]
            : []),
        ...(change.updated.length > 0
            ? change.added
                .filter((tool) => change.updated.includes(tool.name))
                .map((tool) => `- ${tool.name} (replaced)`)
            : [])
    ].join("\n");
}

type McpToolChange =
    | {
        action: "added" | "updated";
        definition: LlmToolDefinition;
    }
    | {
        action: "removed";
        name: string;
    };

function mcpToolChanges(
    previousTools: readonly LlmToolDefinition[],
    currentTools: readonly LlmToolDefinition[]
): McpToolChange[] {
    const previous = new Map(previousTools.map((tool) => [tool.name, tool]));
    const currentNames = new Set(currentTools.map((tool) => tool.name));
    return [
        ...currentTools.flatMap((tool): McpToolChange[] => {
            const prior = previous.get(tool.name);
            if (!prior) {
                return [{
                    action: "added",
                    definition: tool
                }];
            }
            if (definitionKey(prior) !== definitionKey(tool)) {
                return [{
                    action: "updated",
                    definition: tool
                }];
            }
            return [];
        }),
        ...previousTools
            .filter((tool) => !currentNames.has(tool.name))
            .map((tool): McpToolChange => ({
                action: "removed",
                name: tool.name
            }))
    ];
}

function mcpToolChangeInjection(change: McpToolChange): ContextInjection {
    if (change.action === "removed") {
        return {
            declaration: `MCP tool "${change.name}" was removed.`,
            content: `Removed MCP tool: "${change.name}".`
        };
    }
    const { definition } = change;
    return {
        declaration: `MCP tool "${definition.name}" was ${change.action}.`,
        content: [
            `Name: ${definition.name}`,
            `Description: ${definition.description}`,
            `Parameters: ${stableJson(definition.parameters)}`,
            "Use tool_search and load_tool before calling this MCP tool."
        ].join("\n")
    };
}

function definitionKey(tool: LlmToolDefinition): string {
    return `${tool.name}\0${tool.description}\0${stableJson(tool.parameters)}`;
}

function normalizedDefinition(tool: LlmToolDefinition): LlmToolDefinition {
    return {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
    };
}

function parseDefinitions(value: string): LlmToolDefinition[] | null {
    try {
        const parsed = JSON.parse(value) as unknown;
        if (!Array.isArray(parsed)) {
            return null;
        }
        return parsed.filter(isToolDefinition);
    } catch {
        return null;
    }
}

function isToolDefinition(value: unknown): value is LlmToolDefinition {
    return typeof value === "object"
        && value !== null
        && "name" in value
        && typeof value.name === "string"
        && "description" in value
        && typeof value.description === "string"
        && "parameters" in value
        && typeof value.parameters === "object"
        && value.parameters !== null;
}

function stableJson(value: unknown): string {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value) ?? "undefined";
    }
    if (Array.isArray(value)) {
        return `[${value.map(stableJson).join(",")}]`;
    }
    return `{${Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
        .join(",")}}`;
}
