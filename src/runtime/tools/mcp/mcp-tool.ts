import { z } from "zod";
import type {
    LlmImageContent,
    LlmToolCallBlock,
    LlmToolDefinition
} from "../../../protocol/llm.ts";
import type {
    McpCatalogTool,
    McpRuntime
} from "../../../mcp/runtime.ts";
import type { Tool, ToolExecutionContext } from "../tool-manager.ts";
import type {
    DeferredToolDefinition,
    DeferredToolLoadResult,
    ToolExecutionResult
} from "../types.ts";
import { createGenericToolCallViewData } from "../tool-view.ts";
import { LOAD_TOOL } from "../deferred-tools.ts";

export const LIST_MCP_RESOURCES_TOOL = "list_mcp_resources";
export const LIST_MCP_RESOURCE_TEMPLATES_TOOL = "list_mcp_resource_templates";
export const READ_MCP_RESOURCE_TOOL = "read_mcp_resource";

const listResourcesArguments = z.object({
    server: z.string().trim().min(1).optional(),
    cursor: z.string().min(1).optional()
}).strict();

const readResourceArguments = z.object({
    server: z.string().trim().min(1),
    uri: z.string().trim().min(1)
}).strict();

export const MCP_RESOURCE_TOOL_DEFINITIONS: readonly LlmToolDefinition[] = [
    {
        name: LIST_MCP_RESOURCES_TOOL,
        description: "Lists resources provided by MCP servers. Resources allow servers to share data that provides context to language models, such as files, database schemas, or application-specific information. Prefer resources over web search when possible.",
        parameters: {
            type: "object",
            properties: {
                server: {
                    type: "string",
                    description: "MCP server name. Omit to list resources from every configured server."
                },
                cursor: {
                    type: "string",
                    description: "Opaque cursor from a previous list_mcp_resources call; omit for the first page."
                }
            },
            additionalProperties: false
        }
    },
    {
        name: LIST_MCP_RESOURCE_TEMPLATES_TOOL,
        description: "Lists resource templates provided by MCP servers. Parameterized resource templates allow servers to share data that takes parameters and provides context to language models, such as files, database schemas, or application-specific information. Prefer resource templates over web search when possible.",
        parameters: {
            type: "object",
            properties: {
                server: {
                    type: "string",
                    description: "MCP server name. Omit to list resource templates from every configured server."
                },
                cursor: {
                    type: "string",
                    description: "Opaque cursor from a previous list_mcp_resource_templates call; omit for the first page."
                }
            },
            additionalProperties: false
        }
    },
    {
        name: READ_MCP_RESOURCE_TOOL,
        description: "Read a specific resource from an MCP server given the server name and resource URI.",
        parameters: {
            type: "object",
            properties: {
                server: {
                    type: "string",
                    description: "MCP server name exactly as configured. Must match the 'server' field returned by list_mcp_resources."
                },
                uri: {
                    type: "string",
                    description: "Resource URI to read. Must be one of the URIs returned by list_mcp_resources."
                }
            },
            required: ["server", "uri"],
            additionalProperties: false
        }
    }
];

export type McpToolHost = Pick<
    McpRuntime,
    | "tools"
    | "findTool"
    | "callTool"
    | "listResources"
    | "listResourceTemplates"
    | "readResource"
>;

function exactToolMetadata(tool: McpCatalogTool): Readonly<Record<string, unknown>> {
    const { name: _name, ...spec } = tool.spec;
    return {
        server: tool.server,
        toolName: tool.toolName,
        spec: tool.spec,
        ...spec,
        inputSchema: tool.parameters
    };
}

/** Per-session MCP tool facade. Only explicitly loaded catalog tools are advertised. */
export class McpTool implements Tool {
    readonly definitions: readonly LlmToolDefinition[];
    private readonly loaded = new Set<string>();
    private readonly loadedOrder: string[] = [];
    private readonly host: McpToolHost;

    constructor(host: McpToolHost) {
        this.host = host;
        this.definitions = [
            ...MCP_RESOURCE_TOOL_DEFINITIONS,
            ...host.tools.map((tool) => tool.definition)
        ];
    }

    getRegisteredTools(): readonly LlmToolDefinition[] {
        return [
            ...MCP_RESOURCE_TOOL_DEFINITIONS,
            ...this.loadedOrder.flatMap((name) => {
                const tool = this.host.findTool(name);
                return tool ? [tool.definition] : [];
            })
        ];
    }

    getContextSnapshotTools(): readonly LlmToolDefinition[] {
        return this.definitions;
    }

    getDeferredTools(): readonly DeferredToolDefinition[] {
        return this.host.tools.map((tool) => ({
            definition: tool.definition,
            aliases: [
                tool.toolName,
                `${tool.server}/${tool.toolName}`,
                `${tool.server}:${tool.toolName}`
            ],
            searchMetadata: {
                server: tool.server,
                toolName: tool.toolName
            },
            exactMetadata: exactToolMetadata(tool)
        }));
    }

    loadDeferredTool(name: string): DeferredToolLoadResult {
        if (!this.host.findTool(name)) {
            return "unknown";
        }
        if (this.loaded.has(name)) {
            return "already-loaded";
        }
        this.loaded.add(name);
        this.loadedOrder.push(name);
        return "loaded";
    }

    async execute(
        call: LlmToolCallBlock,
        context: ToolExecutionContext
    ): Promise<ToolExecutionResult> {
        switch (call.name) {
            case LIST_MCP_RESOURCES_TOOL:
                return this.listResources(call, context);
            case LIST_MCP_RESOURCE_TEMPLATES_TOOL:
                return this.listResourceTemplates(call, context);
            case READ_MCP_RESOURCE_TOOL:
                return this.readResource(call, context);
            default:
                return this.callLoadedTool(call, context);
        }
    }

    private async listResources(
        call: LlmToolCallBlock,
        context: ToolExecutionContext
    ): Promise<ToolExecutionResult> {
        const parsed = listResourcesArguments.safeParse(call.arguments);
        if (!parsed.success) {
            return toolResult(call, invalidArguments(call.name, parsed.error), true);
        }
        try {
            const payload = await this.host.listResources(
                parsed.data.server,
                parsed.data.cursor,
                context.signal
            );
            return toolResult(call, JSON.stringify(payload, null, 2));
        } catch (error) {
            return toolResult(call, errorMessage(error), true);
        }
    }

    private async listResourceTemplates(
        call: LlmToolCallBlock,
        context: ToolExecutionContext
    ): Promise<ToolExecutionResult> {
        const parsed = listResourcesArguments.safeParse(call.arguments);
        if (!parsed.success) {
            return toolResult(call, invalidArguments(call.name, parsed.error), true);
        }
        try {
            const payload = await this.host.listResourceTemplates(
                parsed.data.server,
                parsed.data.cursor,
                context.signal
            );
            return toolResult(call, JSON.stringify(payload, null, 2));
        } catch (error) {
            return toolResult(call, errorMessage(error), true);
        }
    }

    private async readResource(
        call: LlmToolCallBlock,
        context: ToolExecutionContext
    ): Promise<ToolExecutionResult> {
        const parsed = readResourceArguments.safeParse(call.arguments);
        if (!parsed.success) {
            return toolResult(call, invalidArguments(call.name, parsed.error), true);
        }
        try {
            const payload = await this.host.readResource(
                parsed.data.server,
                parsed.data.uri,
                context.signal
            );
            return toolResult(call, JSON.stringify(payload, null, 2));
        } catch (error) {
            return toolResult(call, errorMessage(error), true);
        }
    }

    private async callLoadedTool(
        call: LlmToolCallBlock,
        context: ToolExecutionContext
    ): Promise<ToolExecutionResult> {
        const tool = this.host.findTool(call.name);
        if (!tool) {
            return toolResult(call, `Unknown MCP tool: ${call.name}`, true);
        }
        if (!this.loaded.has(tool.exposedName)) {
            return toolResult(
                call,
                `MCP tool is not loaded: ${call.name}. Call ${LOAD_TOOL} first.`,
                true
            );
        }
        try {
            const result = await this.host.callTool(
                tool.exposedName,
                call.arguments,
                context.signal
            );
            const content = toolCallContent(result);
            return {
                content: content.text,
                ...(content.images.length > 0 ? { images: content.images } : {}),
                data: {
                    ...createGenericToolCallViewData(
                        call.name,
                        call.arguments,
                        result.isError ? "failed" : "completed"
                    ),
                    output: content.output
                },
                isError: result.isError === true,
                endReason: "exited"
            };
        } catch (error) {
            return toolResult(call, errorMessage(error), true);
        }
    }
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

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function toolCallContent(result: {
    content: readonly unknown[];
    structuredContent?: Record<string, unknown>;
}): {
    text: string;
    output: string;
    images: LlmImageContent[];
} {
    const textParts: string[] = [];
    const images: LlmImageContent[] = [];
    const outputParts: string[] = [];
    for (const item of result.content) {
        if (!isRecord(item) || typeof item.type !== "string") {
            textParts.push(JSON.stringify(item));
            continue;
        }
        switch (item.type) {
            case "text":
                textParts.push(String(item.text ?? ""));
                outputParts.push(String(item.text ?? ""));
                break;
            case "image":
                if (typeof item.data === "string" && typeof item.mimeType === "string") {
                    images.push({ type: "image", data: item.data, mimeType: item.mimeType });
                    outputParts.push(`[Image: ${item.mimeType}]`);
                }
                break;
            case "audio":
                textParts.push(`[Audio: ${String(item.mimeType ?? "unknown")}]`);
                outputParts.push(`[Audio: ${String(item.mimeType ?? "unknown")}]`);
                break;
            case "resource":
                textParts.push(JSON.stringify(item.resource));
                outputParts.push(JSON.stringify(item.resource));
                break;
            case "resource_link":
                textParts.push(`[Resource: ${String(item.name ?? item.uri ?? "unknown")}] ${String(item.uri ?? "")}`);
                outputParts.push(`[Resource: ${String(item.uri ?? "")}]`);
                break;
            default:
                textParts.push(JSON.stringify(item));
                outputParts.push(JSON.stringify(item));
                break;
        }
    }
    const structured = result.structuredContent
        ? JSON.stringify(result.structuredContent, null, 2)
        : undefined;
    if (structured && textParts.length === 0) {
        textParts.push(structured);
        outputParts.push(structured);
    } else if (structured) {
        textParts.push(`Structured content:\n${structured}`);
        outputParts.push(`Structured content:\n${structured}`);
    }
    return {
        text: textParts.join("\n"),
        output: outputParts.join("\n"),
        images
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
