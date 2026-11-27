import { createRequire } from "node:module";
import { expect, test } from "vitest";
import type { LlmToolCallBlock } from "../protocol/llm.ts";
import {
    LOAD_TOOL,
    TOOL_SEARCH_TOOL
} from "../runtime/tools/deferred-tools.ts";
import {
    LIST_MCP_RESOURCES_TOOL,
    LIST_MCP_RESOURCE_TEMPLATES_TOOL,
    McpTool,
    READ_MCP_RESOURCE_TOOL
} from "../runtime/tools/mcp/mcp-tool.ts";
import { ToolManagerRegistry } from "../runtime/tools/tool-manager-registry.ts";
import type {
    ToolExecutionResult,
    ToolExecutor
} from "../runtime/tools/types.ts";
import { McpRuntime } from "./runtime.ts";

const require = createRequire(import.meta.url);
const everythingServer = require.resolve(
    "@modelcontextprotocol/server-everything/dist/index.js"
);

test("connects to server-everything and exercises tools and resources", {
    timeout: 30_000
}, async () => {
    const runtime = await McpRuntime.connect({
        everything: {
            transport: "stdio",
            enabled: true,
            command: process.execPath,
            args: [everythingServer, "stdio"]
        }
    });

    try {
        expect(runtime.hasServers).toBe(true);
        const echo = runtime.tools.find((tool) => tool.toolName === "echo");
        expect(echo).toBeDefined();
        if (!echo) {
            throw new Error("server-everything did not expose the echo tool");
        }

        const tools = new ToolManagerRegistry({
            sessionId: "mcp-integration-session",
            permission: () => "read-only",
            workingDirectories: () => []
        }, [new McpTool(runtime)]);
        const fuzzy = JSON.parse(text(await execute(tools, TOOL_SEARCH_TOOL, {
            query: "echo",
            mode: "fuzzy"
        })));
        expect(fuzzy.tools).toContainEqual(expect.objectContaining({
            name: echo.exposedName,
            server: "everything",
            toolName: "echo"
        }));

        const exact = JSON.parse(text(await execute(tools, TOOL_SEARCH_TOOL, {
            query: echo.exposedName,
            mode: "exact"
        })));
        expect(exact.tools[0]).toMatchObject({
            name: echo.exposedName,
            server: "everything",
            toolName: "echo",
            inputSchema: echo.spec.inputSchema
        });

        const loaded = await execute(tools, LOAD_TOOL, {
            name: echo.exposedName
        });
        expect(loaded.isError).toBe(false);
        expect(registeredNames(tools)).toContain(echo.exposedName);

        const called = await execute(tools, echo.exposedName, {
            message: "hello from mcp"
        });
        expect(called.isError).toBe(false);
        expect(text(called)).toContain("Echo: hello from mcp");

        const resources = JSON.parse(text(
            await execute(tools, LIST_MCP_RESOURCES_TOOL, {})
        ));
        expect(resources.resources.length).toBeGreaterThan(0);
        const resource = resources.resources[0];
        expect(resource.server).toBe("everything");

        const templates = JSON.parse(text(
            await execute(tools, LIST_MCP_RESOURCE_TEMPLATES_TOOL, {})
        ));
        expect(templates.resourceTemplates.length).toBeGreaterThan(0);

        const read = JSON.parse(text(
            await execute(tools, READ_MCP_RESOURCE_TOOL, {
                server: resource.server,
                uri: resource.uri
            })
        ));
        expect(read.contents.length).toBeGreaterThan(0);
    } finally {
        await runtime.close();
    }
});

function execute(
    tool: ToolExecutor,
    name: string,
    arguments_: Record<string, unknown>
) {
    return tool.execute(
        call(name, arguments_),
        { onOutput: () => undefined },
        new AbortController().signal
    );
}

function call(
    name: string,
    arguments_: Record<string, unknown>
): LlmToolCallBlock {
    return {
        type: "toolCall",
        id: "mcp-integration-call",
        name,
        arguments: arguments_
    };
}

function registeredNames(tool: ToolExecutor): string[] {
    return tool.getRegisteredTools?.("read-only").map((definition) => definition.name) ?? [];
}

function text(result: ToolExecutionResult): string {
    return typeof result.content === "string"
        ? result.content
        : JSON.stringify(result.content);
}
