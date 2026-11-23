import type { LlmToolCallBlock, LlmToolDefinition } from "../../protocol/llm.ts";
import type { PermissionMode } from "../../protocol/permission.ts";
import type {
    ToolExecutionObserver,
    ToolExecutionResult,
    ToolExecutor,
    ToolStopEvent
} from "./types.ts";

/** Dispatches tool calls to a named set of executors. */
export class ToolRegistry implements ToolExecutor {
    readonly definitions: readonly LlmToolDefinition[];
    private readonly executors = new Map<string, ToolExecutor>();

    constructor(executors: readonly ToolExecutor[]) {
        const definitions: LlmToolDefinition[] = [];
        for (const executor of executors) {
            for (const definition of executor.definitions) {
                if (this.executors.has(definition.name)) {
                    throw new Error(`Duplicate tool definition: ${definition.name}`);
                }
                this.executors.set(definition.name, executor);
                definitions.push(definition);
            }
        }
        this.definitions = definitions;
    }

    handles(name: string): boolean {
        return this.executors.has(name);
    }

    hasActiveWork(): boolean {
        return [...new Set(this.executors.values())].some(
            (executor) => executor.hasActiveWork?.() === true
        );
    }

    getRegisteredTools(permission: PermissionMode): readonly LlmToolDefinition[] {
        return [...new Set(this.executors.values())].flatMap(
            (executor) => executor.getRegisteredTools?.(permission) ?? executor.definitions
        );
    }

    async execute(
        call: LlmToolCallBlock,
        observer: ToolExecutionObserver,
        signal?: AbortSignal
    ): Promise<ToolExecutionResult> {
        const executor = this.executors.get(call.name);
        if (!executor) {
            throw new Error(`Tool not registered: ${call.name}`);
        }
        return executor.execute(call, observer, signal);
    }

    async stop(): Promise<readonly ToolStopEvent[]> {
        const events: ToolStopEvent[] = [];
        for (const executor of new Set(this.executors.values())) {
            events.push(...await executor.stop());
        }
        return events;
    }

    dispose(): void {
        for (const executor of new Set(this.executors.values())) {
            executor.dispose();
        }
        this.executors.clear();
    }
}
