import type {
    LlmToolCallBlock,
    LlmToolDefinition
} from "../../protocol/llm.ts";
import type { PermissionMode } from "../../protocol/permission.ts";
import type {
    Tool,
    ToolExecutionContext,
    ToolManager,
    ToolManagerContext
} from "./tool-manager.ts";
import type {
    DeferredToolDefinition,
    DeferredToolLoadResult,
    ToolExecutionObserver,
    ToolExecutionResult,
    ToolExecutor,
    ToolStopEvent
} from "./types.ts";
import { DeferredToolLoader } from "./deferred-tools.ts";

type RegisteredTool = {
    managerId: string | null;
    tool: Tool;
};

type ManagerRegistration = {
    tools: readonly Tool[];
};

export class ToolManagerRegistry implements ToolExecutor {
    private readonly context: ToolManagerContext;
    private readonly tools = new Map<string, RegisteredTool>();
    private readonly ownedTools = new Set<Tool>();
    private readonly managers = new Map<string, ManagerRegistration>();
    private readonly activeCalls = new Map<Tool, number>();
    private readonly idleWaiters = new Map<Tool, Set<() => void>>();
    private readonly disposedTools = new Set<Tool>();
    private readonly deferredLoader = new DeferredToolLoader({
        deferredTools: () => this.deferredTools(),
        loadDeferredTool: (name) => this.loadDeferredToolDefinition(name)
    });

    constructor(
        context: ToolManagerContext,
        initialTools: readonly Tool[] = []
    ) {
        this.context = context;
        const tools = [...new Set(initialTools)];
        this.assertUniqueTools(tools);
        this.assertUniqueDeferredTools(tools);
        for (const tool of tools) {
            this.addTool(null, tool);
        }
        this.assertUniqueTools([this.deferredLoader]);
        this.addTool(null, this.deferredLoader);
    }

    get definitions(): readonly LlmToolDefinition[] {
        return [
            ...[...this.ownedTools]
                .filter((tool) => tool !== this.deferredLoader)
                .flatMap((tool) => tool.definitions),
            ...this.deferredLoader.definitions
        ];
    }

    handles(name: string): boolean {
        return this.tools.has(name);
    }

    hasActiveWork(): boolean {
        return this.activeCalls.size > 0
            || [...this.ownedTools].some((tool) => tool.hasActiveWork?.() === true);
    }

    getRegisteredTools(permission: PermissionMode): readonly LlmToolDefinition[] {
        return [
            ...[...this.ownedTools]
                .filter((tool) => tool !== this.deferredLoader)
                .flatMap(
                    (tool) => tool.getRegisteredTools?.(permission) ?? tool.definitions
                ),
            ...(this.deferredLoader.getRegisteredTools?.(permission)
                ?? this.deferredLoader.definitions)
        ];
    }

    private deferredTools(): readonly DeferredToolDefinition[] {
        return [...this.ownedTools].flatMap(
            (tool) => tool.getDeferredTools?.() ?? []
        );
    }

    private loadDeferredToolDefinition(name: string): DeferredToolLoadResult {
        const owner = [...this.ownedTools].find(
            (tool) => tool.getDeferredTools?.().some(
                (deferred) => deferred.definition.name === name
            ) === true
        );
        return owner?.loadDeferredTool?.(name) ?? "unknown";
    }

    registerManager(manager: ToolManager): void {
        if (this.managers.has(manager.id)) {
            throw new Error(`Tool manager already registered: ${manager.id}`);
        }

        const tools = [...new Set(manager.create(this.context))];
        try {
            this.assertUniqueTools(tools);
            this.assertUniqueDeferredTools([...new Set([...this.ownedTools, ...tools])]);
        } catch (error) {
            for (const tool of tools.filter((item) => !this.ownedTools.has(item))) {
                tool.dispose?.();
            }
            throw error;
        }

        this.managers.set(manager.id, { tools });
        for (const tool of tools) {
            this.addTool(manager.id, tool);
        }
    }

    async unregisterManager(managerId: string): Promise<void> {
        const registration = this.managers.get(managerId);
        if (!registration) {
            return;
        }
        this.managers.delete(managerId);

        for (const [name, entry] of this.tools) {
            if (entry.managerId !== managerId) {
                continue;
            }
            this.tools.delete(name);
        }
        for (const tool of registration.tools) {
            this.ownedTools.delete(tool);
        }

        await Promise.all(registration.tools.map((tool) => this.retireTool(tool)));
    }

    async execute(
        call: LlmToolCallBlock,
        observer: ToolExecutionObserver,
        signal?: AbortSignal
    ): Promise<ToolExecutionResult> {
        const entry = this.tools.get(call.name);
        if (!entry) {
            throw new Error(`Tool not registered: ${call.name}`);
        }

        const tool = entry.tool;
        this.activeCalls.set(tool, (this.activeCalls.get(tool) ?? 0) + 1);
        const context: ToolExecutionContext = {
            ...observer,
            sessionId: this.context.sessionId,
            permission: this.context.permission(),
            workingDirectories: this.context.workingDirectories(),
            signal: signal ?? new AbortController().signal
        };

        try {
            return await tool.execute(call, context);
        } finally {
            this.finishCall(tool);
        }
    }

    async stop(): Promise<readonly ToolStopEvent[]> {
        const events: ToolStopEvent[] = [];
        for (const tool of this.ownedTools) {
            if (tool.stop) {
                events.push(...await tool.stop());
            }
        }
        return events;
    }

    dispose(): void {
        for (const tool of this.ownedTools) {
            if (this.disposedTools.has(tool)) {
                continue;
            }
            this.disposedTools.add(tool);
            tool.dispose?.();
        }
        this.ownedTools.clear();
        this.tools.clear();
        this.managers.clear();
    }

    private addTool(managerId: string | null, tool: Tool): void {
        this.ownedTools.add(tool);
        for (const definition of tool.definitions) {
            this.tools.set(definition.name, { managerId, tool });
        }
    }

    private assertUniqueTools(tools: readonly Tool[]): void {
        const names = new Set<string>();
        for (const tool of tools) {
            for (const definition of tool.definitions) {
                if (this.tools.has(definition.name) || names.has(definition.name)) {
                    throw new Error(`Duplicate tool definition: ${definition.name}`);
                }
                names.add(definition.name);
            }
        }
    }

    private assertUniqueDeferredTools(tools: readonly Tool[]): void {
        const owners = new Map<string, Tool>();
        const builtInNames = new Set(
            this.deferredLoader.definitions.map((definition) => definition.name)
        );
        for (const tool of tools) {
            for (const deferred of tool.getDeferredTools?.() ?? []) {
                const name = deferred.definition.name;
                if (builtInNames.has(name)) {
                    throw new Error(
                        `Deferred tool definition conflicts with built-in tool: ${name}`
                    );
                }
                if (owners.has(name)) {
                    throw new Error(`Duplicate deferred tool definition: ${name}`);
                }
                owners.set(name, tool);
            }
        }
    }

    private finishCall(tool: Tool): void {
        const remaining = (this.activeCalls.get(tool) ?? 1) - 1;
        if (remaining > 0) {
            this.activeCalls.set(tool, remaining);
            return;
        }

        this.activeCalls.delete(tool);
        const waiters = this.idleWaiters.get(tool);
        if (!waiters) {
            return;
        }
        this.idleWaiters.delete(tool);
        for (const resolve of waiters) {
            resolve();
        }
    }

    private retireTool(tool: Tool): Promise<void> {
        if (this.disposedTools.has(tool)) {
            return Promise.resolve();
        }
        if ((this.activeCalls.get(tool) ?? 0) === 0) {
            return this.disposeTool(tool);
        }

        return new Promise<void>((resolve) => {
            const waiters = this.idleWaiters.get(tool) ?? new Set();
            waiters.add(resolve);
            this.idleWaiters.set(tool, waiters);
        }).then(() => this.disposeTool(tool));
    }

    private async disposeTool(tool: Tool): Promise<void> {
        if (this.disposedTools.has(tool)) {
            return;
        }
        this.disposedTools.add(tool);
        try {
            await tool.stop?.();
        } finally {
            tool.dispose?.();
        }
    }
}
