import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
    CallToolResult,
    ReadResourceResult,
    Resource,
    ResourceTemplate,
    Tool
} from "@modelcontextprotocol/sdk/types.js";
import { type JarvixLogger, noopLogger } from "../core/logger.ts";
import type { JarvixMcpServerConfig } from "../protocol/config.ts";
import type { LlmToolDefinition } from "../protocol/llm.ts";

const CLIENT_NAME = "jarvix";
const CLIENT_VERSION = "0.1.0";
const CONNECT_TIMEOUT_MS = 15_000;
const MAX_TOOL_NAME_LENGTH = 64;

export type McpCatalogTool = {
    exposedName: string;
    server: string;
    toolName: string;
    description: string;
    parameters: Record<string, unknown>;
    spec: Tool;
    definition: LlmToolDefinition;
};

type ConnectedServer = {
    name: string;
    client: Client;
    tools: readonly Tool[];
};

type ServerListResult<T> =
    | { server: string; result: T }
    | { server: string; error: string };

type ResourceWithServer<T> = T & { server: string };

export type ListMcpResourcesPayload = {
    server?: string;
    resources: ResourceWithServer<Resource>[];
    nextCursor?: string;
    errors?: Array<{ server: string; error: string }>;
};

export type ListMcpResourceTemplatesPayload = {
    server?: string;
    resourceTemplates: ResourceWithServer<ResourceTemplate>[];
    nextCursor?: string;
    errors?: Array<{ server: string; error: string }>;
};

export type ReadMcpResourcePayload = {
    server: string;
    uri: string;
    contents: ReadResourceResult["contents"];
    meta?: ReadResourceResult["_meta"];
};

/** Holds one initialized connection per configured MCP server. */
export class McpRuntime {
    private readonly servers: readonly ConnectedServer[];
    private readonly catalog: readonly McpCatalogTool[];
    private readonly catalogByName: ReadonlyMap<string, McpCatalogTool>;
    private closePromise?: Promise<void>;

    private constructor(
        servers: readonly ConnectedServer[],
        catalog: readonly McpCatalogTool[]
    ) {
        this.servers = servers;
        this.catalog = catalog;
        this.catalogByName = new Map(catalog.map((tool) => [tool.exposedName, tool]));
    }

    static async connect(
        configs: Readonly<Record<string, JarvixMcpServerConfig>> | undefined,
        logger: JarvixLogger = noopLogger
    ): Promise<McpRuntime> {
        const connections = await Promise.all(
            Object.entries(configs ?? {})
                .filter(([, config]) => config.enabled !== false)
                .map(([name, config]) => connectServer(name, config, logger))
        );
        const servers = connections.filter(
            (server): server is ConnectedServer => server !== null
        );
        return new McpRuntime(servers, buildCatalog(servers));
    }

    get tools(): readonly McpCatalogTool[] {
        return this.catalog;
    }

    get hasServers(): boolean {
        return this.servers.length > 0;
    }

    findTool(name: string): McpCatalogTool | undefined {
        return this.catalogByName.get(name);
    }

    findToolsByExactName(name: string): readonly McpCatalogTool[] {
        const exposed = this.catalogByName.get(name);
        if (exposed) {
            return [exposed];
        }
        return this.catalog.filter((tool) => (
            tool.toolName === name
            || `${tool.server}/${tool.toolName}` === name
            || `${tool.server}:${tool.toolName}` === name
        ));
    }

    async callTool(
        name: string,
        arguments_: Record<string, unknown>,
        signal?: AbortSignal
    ): Promise<CallToolResult> {
        const tool = this.catalogByName.get(name);
        if (!tool) {
            throw new Error(`Unknown MCP tool: ${name}`);
        }
        const server = this.requireServer(tool.server);
        const result = await server.client.callTool(
            {
                name: tool.toolName,
                arguments: arguments_
            },
            undefined,
            { signal }
        );
        return result as CallToolResult;
    }

    async listResources(
        serverName?: string,
        cursor?: string,
        signal?: AbortSignal
    ): Promise<ListMcpResourcesPayload> {
        if (serverName) {
            const result = await this.requireServer(serverName).client.listResources(
                cursor ? { cursor } : undefined,
                { signal }
            );
            return {
                server: serverName,
                resources: withServer(serverName, result.resources),
                ...(result.nextCursor ? { nextCursor: result.nextCursor } : {})
            };
        }
        if (cursor) {
            throw new Error("cursor can only be used when a server is specified");
        }
        const results = await Promise.all(this.servers.map(
            async (server): Promise<ServerListResult<{
                resources: Resource[];
                nextCursor?: string;
            }>> => {
                try {
                    return {
                        server: server.name,
                        result: await server.client.listResources(undefined, { signal })
                    };
                } catch (error) {
                    return { server: server.name, error: errorMessage(error) };
                }
            }
        ));
        const errors = results.flatMap((result) => (
            "error" in result
                ? [{ server: result.server, error: result.error }]
                : []
        ));
        return {
            resources: results.flatMap((result) => (
                "result" in result
                    ? withServer(result.server, result.result.resources)
                    : []
            )),
            ...(errors.length > 0 ? { errors } : {})
        };
    }

    async listResourceTemplates(
        serverName?: string,
        cursor?: string,
        signal?: AbortSignal
    ): Promise<ListMcpResourceTemplatesPayload> {
        if (serverName) {
            const result = await this.requireServer(serverName).client.listResourceTemplates(
                cursor ? { cursor } : undefined,
                { signal }
            );
            return {
                server: serverName,
                resourceTemplates: withServer(serverName, result.resourceTemplates),
                ...(result.nextCursor ? { nextCursor: result.nextCursor } : {})
            };
        }
        if (cursor) {
            throw new Error("cursor can only be used when a server is specified");
        }
        const results = await Promise.all(this.servers.map(
            async (server): Promise<ServerListResult<{
                resourceTemplates: ResourceTemplate[];
                nextCursor?: string;
            }>> => {
                try {
                    return {
                        server: server.name,
                        result: await server.client.listResourceTemplates(undefined, { signal })
                    };
                } catch (error) {
                    return { server: server.name, error: errorMessage(error) };
                }
            }
        ));
        const errors = results.flatMap((result) => (
            "error" in result
                ? [{ server: result.server, error: result.error }]
                : []
        ));
        return {
            resourceTemplates: results.flatMap((result) => (
                "result" in result
                    ? withServer(result.server, result.result.resourceTemplates)
                    : []
            )),
            ...(errors.length > 0 ? { errors } : {})
        };
    }

    async readResource(
        serverName: string,
        uri: string,
        signal?: AbortSignal
    ): Promise<ReadMcpResourcePayload> {
        const result = await this.requireServer(serverName).client.readResource(
            { uri },
            { signal }
        );
        return {
            server: serverName,
            uri,
            contents: result.contents,
            ...(result._meta ? { meta: result._meta } : {})
        };
    }

    async close(): Promise<void> {
        this.closePromise ??= Promise.allSettled(
            this.servers.map((server) => server.client.close())
        ).then(() => undefined);
        return this.closePromise;
    }

    private requireServer(name: string): ConnectedServer {
        const server = this.servers.find((item) => item.name === name);
        if (!server) {
            throw new Error(`Unknown MCP server: ${name}`);
        }
        return server;
    }
}

async function connectServer(
    name: string,
    config: JarvixMcpServerConfig,
    logger: JarvixLogger
): Promise<ConnectedServer | null> {
    const client = new Client(
        { name: CLIENT_NAME, version: CLIENT_VERSION },
        { capabilities: {} }
    );
    try {
        const transport = createTransport(config, logger);
        const controller = new AbortController();
        const timer = setTimeout(
            () => controller.abort(new Error("MCP connection timed out")),
            CONNECT_TIMEOUT_MS
        );
        try {
            await client.connect(transport, {
                signal: controller.signal,
                timeout: CONNECT_TIMEOUT_MS
            });
        } finally {
            clearTimeout(timer);
        }
        let tools: readonly Tool[] = [];
        try {
            tools = await listAllTools(client);
        } catch (error) {
            logger.warn("MCP server tools could not be listed", {
                server: name,
                reason: errorMessage(error)
            });
        }
        logger.info("MCP server connected", {
            server: name,
            toolCount: tools.length
        });
        logger.debug("MCP tool catalog", {
            server: name,
            tools: tools.map((tool) => tool.name)
        });
        return { name, client, tools };
    } catch (error) {
        await client.close().catch(() => undefined);
        logger.warn("MCP server failed to initialize", {
            server: name,
            reason: errorMessage(error)
        });
        return null;
    }
}

function createTransport(
    config: JarvixMcpServerConfig,
    logger: JarvixLogger
): Transport {
    if (config.command) {
        const transport = new StdioClientTransport({
            command: config.command,
            args: config.args,
            env: config.env,
            cwd: config.cwd,
            stderr: "pipe"
        });
        transport.stderr?.on("data", (chunk: Buffer) => {
            logger.debug("MCP server stderr", {
                server: config.command,
                output: chunk.toString("utf8").trimEnd()
            });
        });
        return transport;
    }
    if (!config.url) {
        throw new Error("MCP server requires command or url");
    }
    const url = new URL(config.url);
    const requestInit = config.headers
        ? { headers: config.headers }
        : undefined;
    return config.transport === "sse"
        ? new SSEClientTransport(url, { requestInit })
        : new StreamableHTTPClientTransport(url, { requestInit });
}

async function listAllTools(client: Client): Promise<readonly Tool[]> {
    const tools: Tool[] = [];
    let cursor: string | undefined;
    do {
        const result = await client.listTools(cursor ? { cursor } : undefined);
        tools.push(...result.tools);
        cursor = result.nextCursor;
    } while (cursor);
    return tools;
}

function buildCatalog(servers: readonly ConnectedServer[]): readonly McpCatalogTool[] {
    const usedNames = new Set<string>();
    const catalog: McpCatalogTool[] = [];
    for (const server of servers) {
        for (const tool of server.tools) {
            const exposedName = uniqueToolName(server.name, tool.name, usedNames);
            const description = tool.description ?? tool.title ?? "";
            const parameters = tool.inputSchema as Record<string, unknown>;
            catalog.push({
                exposedName,
                server: server.name,
                toolName: tool.name,
                description,
                parameters,
                spec: tool,
                definition: {
                    name: exposedName,
                    description: description || `MCP tool "${tool.name}" from server "${server.name}".`,
                    parameters
                }
            });
        }
    }
    return catalog;
}

function uniqueToolName(
    serverName: string,
    toolName: string,
    usedNames: Set<string>
): string {
    const base = fitToolName(
        `mcp__${nameSegment(serverName)}__${nameSegment(toolName)}`,
        serverName,
        toolName
    );
    if (!usedNames.has(base)) {
        usedNames.add(base);
        return base;
    }
    let attempt = 1;
    while (true) {
        const suffix = `__${shortHash(`${serverName}\0${toolName}\0${attempt}`)}`;
        const candidate = `${base.slice(0, MAX_TOOL_NAME_LENGTH - suffix.length)}${suffix}`;
        if (!usedNames.has(candidate)) {
            usedNames.add(candidate);
            return candidate;
        }
        attempt += 1;
    }
}

function fitToolName(base: string, serverName: string, toolName: string): string {
    if (base.length <= MAX_TOOL_NAME_LENGTH) {
        return base;
    }
    const suffix = `__${shortHash(`${serverName}\0${toolName}`)}`;
    return `${base.slice(0, MAX_TOOL_NAME_LENGTH - suffix.length)}${suffix}`;
}

function nameSegment(value: string): string {
    return value.replace(/[^A-Za-z0-9_-]/g, "_") || "server";
}

function shortHash(value: string): string {
    return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function withServer<T>(server: string, values: readonly T[]): ResourceWithServer<T>[] {
    return values.map((value) => ({ ...value, server }));
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
