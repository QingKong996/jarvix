import type {
    LlmSystemMessage,
    LlmToolDefinition
} from "../../../protocol/llm.ts";

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
    const previous = new Map(state.current.map((tool) => [tool.name, tool]));
    const next = new Map(current.map((tool) => [tool.name, tool]));
    const added = current.filter((tool) => {
        const prior = previous.get(tool.name);
        return !prior || definitionKey(prior) !== definitionKey(tool);
    });
    const removed = state.current
        .filter((tool) => {
            const replacement = next.get(tool.name);
            return !replacement || definitionKey(replacement) !== definitionKey(tool);
        })
        .map((tool) => ({ name: tool.name }));

    if (added.length === 0 && removed.length === 0) {
        return false;
    }
    state.changes.push({
        role: "system",
        content: "",
        timestamp: Date.now(),
        ...(added.length > 0 ? { toolsAdded: added } : {}),
        ...(removed.length > 0 ? { toolsRemoved: removed } : {})
    });
    state.current = current;
    return true;
}

function definitionKey(tool: LlmToolDefinition): string {
    return `${tool.name}\0${tool.description}\0${stableJson(tool.parameters)}`;
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
