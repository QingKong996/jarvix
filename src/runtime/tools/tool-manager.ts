import type {
    LlmToolCallBlock,
    LlmToolDefinition
} from "../../protocol/llm.ts";
import type { PermissionMode } from "../../protocol/permission.ts";
import type {
    ToolExecutionObserver,
    ToolExecutionResult,
    ToolExecutor,
    ToolStopEvent
} from "./types.ts";

export type ToolManagerContext = {
    readonly sessionId: string;
    permission(): PermissionMode;
    workingDirectories(): readonly string[];
};

export type ToolExecutionContext = ToolExecutionObserver & {
    readonly sessionId: string;
    readonly permission: PermissionMode;
    readonly workingDirectories: readonly string[];
    readonly signal: AbortSignal;
};

export type Tool = {
    readonly definitions: readonly LlmToolDefinition[];
    getRegisteredTools?(permission: PermissionMode): readonly LlmToolDefinition[];
    hasActiveWork?(): boolean;
    execute(
        call: LlmToolCallBlock,
        context: ToolExecutionContext
    ): Promise<ToolExecutionResult>;
    stop?(): Promise<readonly ToolStopEvent[]>;
    dispose?(): void;
};

export interface ToolManager {
    readonly id: string;
    /** Creates the tool instances owned by one session's tool manager. */
    create(context: ToolManagerContext): readonly Tool[];
    dispose?(): void;
}

export function toolFromExecutor(executor: ToolExecutor): Tool {
    return {
        definitions: executor.definitions,
        getRegisteredTools: executor.getRegisteredTools?.bind(executor),
        hasActiveWork: executor.hasActiveWork?.bind(executor),
        execute(call, context) {
            return executor.execute(
                call,
                {
                    onOutput: context.onOutput,
                    onBackgroundEnd: context.onBackgroundEnd,
                    onTaskEvent: context.onTaskEvent,
                    requestPermission: context.requestPermission
                },
                context.signal
            );
        },
        stop: () => executor.stop(),
        dispose: () => executor.dispose()
    };
}
