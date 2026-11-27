import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { expect, test, vi } from "vitest";
import type {
    ListMcpResourcesPayload,
    ListMcpResourceTemplatesPayload,
    McpCatalogTool,
    ReadMcpResourcePayload
} from "../../../mcp/runtime.ts";
import type { LlmToolCallBlock } from "../../../protocol/llm.ts";
import type { ToolExecutionContext } from "../tool-manager.ts";
import {
    LIST_MCP_RESOURCE_TEMPLATES_TOOL,
    LIST_MCP_RESOURCES_TOOL,
    LOAD_TOOL,
    McpTool,
    READ_MCP_RESOURCE_TOOL,
    TOOL_SEARCH_TOOL,
    type McpToolHost
} from "./mcp-tool.ts";

const longDescription = "a".repeat(1100);
const spec: Tool = {
    name: "read_file",
    description: longDescription,
    inputSchema: {
        type: "object",
        properties: {
            path: {
                type: "string",
                description: "File path"
            }
        },
        required: ["path"]
    },
    annotations: {
        title: "Read a file"
    }
};
const catalogTool: McpCatalogTool = {
    exposedName: "mcp__filesystem__read_file",
    server: "filesystem",
    toolName: "read_file",
    description: longDescription,
    parameters: spec.inputSchema,
    spec,
    definition: {
        name: "mcp__filesystem__read_file",
        description: longDescription,
        parameters: spec.inputSchema
    }
};

test("tool_search truncates fuzzy descriptions and returns full exact specs", async () => {
    const tool = new McpTool(host());

    const fuzzy = await execute(tool, TOOL_SEARCH_TOOL, {
        query: "read",
        mode: "fuzzy"
    });
    const fuzzyPayload = JSON.parse(text(fuzzy.content));
    expect(fuzzyPayload.tools).toHaveLength(1);
    expect(fuzzyPayload.tools[0].description).toContain(
        "a".repeat(1024)
    );
    expect(fuzzyPayload.tools[0].description).toContain(
        "76 characters remaining"
    );
    expect(fuzzyPayload.tools[0]).not.toHaveProperty("inputSchema");

    const exact = await execute(tool, TOOL_SEARCH_TOOL, {
        query: "mcp__filesystem__read_file",
        mode: "exact"
    });
    const exactPayload = JSON.parse(text(exact.content));
    expect(exactPayload.tools[0]).toMatchObject({
        name: "mcp__filesystem__read_file",
        server: "filesystem",
        toolName: "read_file",
        description: longDescription,
        inputSchema: spec.inputSchema,
        annotations: {
            title: "Read a file"
        }
    });
});

test("load_tool mounts a tool and exposes MCP resource tools", async () => {
    const toolHost = host();
    const tool = new McpTool(toolHost);
    expect(tool.getRegisteredTools().map((definition) => definition.name))
        .not.toContain(catalogTool.exposedName);
    expect(tool.getRegisteredTools().map((definition) => definition.name)).toEqual(
        expect.arrayContaining([
            TOOL_SEARCH_TOOL,
            LOAD_TOOL,
            LIST_MCP_RESOURCES_TOOL,
            LIST_MCP_RESOURCE_TEMPLATES_TOOL,
            READ_MCP_RESOURCE_TOOL
        ])
    );

    const loaded = await execute(tool, LOAD_TOOL, {
        name: "filesystem/read_file"
    });
    expect(loaded.isError).toBe(false);
    expect(tool.getRegisteredTools().map((definition) => definition.name))
        .toContain(catalogTool.exposedName);

    const called = await execute(tool, catalogTool.exposedName, {
        path: "README.md"
    });
    expect(toolHost.callTool).toHaveBeenCalledWith(
        catalogTool.exposedName,
        { path: "README.md" },
        expect.any(AbortSignal)
    );
    expect(called.content).toBe("file contents");

    const resources = await execute(tool, LIST_MCP_RESOURCES_TOOL, {});
    expect(JSON.parse(text(resources.content))).toMatchObject({
        resources: [{
            server: "filesystem",
            uri: "file:///README.md",
            name: "README.md"
        }]
    });

    const read = await execute(tool, READ_MCP_RESOURCE_TOOL, {
        server: "filesystem",
        uri: "file:///README.md"
    });
    expect(JSON.parse(text(read.content))).toMatchObject({
        server: "filesystem",
        uri: "file:///README.md",
        contents: [{
            text: "resource contents"
        }]
    });
});

function host(): McpToolHost & {
    callTool: ReturnType<typeof vi.fn>;
    listResources: ReturnType<typeof vi.fn>;
    listResourceTemplates: ReturnType<typeof vi.fn>;
    readResource: ReturnType<typeof vi.fn>;
} {
    return {
        tools: [catalogTool],
        findTool: (name: string) => (
            name === catalogTool.exposedName ? catalogTool : undefined
        ),
        findToolsByExactName: (name: string) => (
            name === catalogTool.exposedName
            || name === catalogTool.toolName
            || name === "filesystem/read_file"
                ? [catalogTool]
                : []
        ),
        callTool: vi.fn(async () => ({
            content: [{ type: "text" as const, text: "file contents" }]
        })),
        listResources: vi.fn(async (): Promise<ListMcpResourcesPayload> => ({
            resources: [{
                server: "filesystem",
                uri: "file:///README.md",
                name: "README.md"
            }]
        })),
        listResourceTemplates: vi.fn(async (): Promise<ListMcpResourceTemplatesPayload> => ({
            resourceTemplates: []
        })),
        readResource: vi.fn(async (
            server: string,
            uri: string
        ): Promise<ReadMcpResourcePayload> => ({
            server,
            uri,
            contents: [{
                uri,
                text: "resource contents"
            }]
        }))
    } as McpToolHost & {
        callTool: ReturnType<typeof vi.fn>;
        listResources: ReturnType<typeof vi.fn>;
        listResourceTemplates: ReturnType<typeof vi.fn>;
        readResource: ReturnType<typeof vi.fn>;
    };
}

function execute(
    tool: McpTool,
    name: string,
    arguments_: Record<string, unknown>
) {
    return tool.execute(call(name, arguments_), context());
}

function call(
    name: string,
    arguments_: Record<string, unknown>
): LlmToolCallBlock {
    return {
        type: "toolCall",
        id: "call-1",
        name,
        arguments: arguments_
    };
}

function context(): ToolExecutionContext {
    return {
        sessionId: "session-1",
        permission: "read-only",
        workingDirectories: [],
        signal: new AbortController().signal,
        onOutput: () => undefined
    };
}

function text(content: string | readonly unknown[]): string {
    return typeof content === "string" ? content : JSON.stringify(content);
}
