import type { McpRuntime } from "../../../mcp/runtime.ts";
import type { ToolManager } from "../tool-manager.ts";
import { McpTool } from "./mcp-tool.ts";

export const MCP_TOOL_MANAGER_ID = "jarvix.mcp";

export function createMcpToolManager(runtime: McpRuntime): ToolManager {
    return {
        id: MCP_TOOL_MANAGER_ID,
        create() {
            return [new McpTool(runtime)];
        },
        dispose() {
            void runtime.close();
        }
    };
}
