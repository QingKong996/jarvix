import type {
    LlmImageContent,
    LlmToolCallBlock,
    LlmToolDefinition
} from "../../protocol/llm.ts";
import type {
    PermissionDecision,
    PermissionGrantInput,
    PermissionMode
} from "../../protocol/permission.ts";
import type { ToolCallOutputDelta, ToolCallViewData } from "./view.ts";

export type ToolCallEndReason = "exited" | "background" | "terminated";

export type ToolTaskState = {
    id: string;
    kind: "shell";
    command: string;
    cwd: string;
    status: "running" | "completed" | "failed";
    exitCode: number | null;
    error: string | null;
    unreadCharacters: number;
    truncatedCharacters: number;
};

export type ToolTaskSnapshot = ToolTaskState & {
    output: string;
};

export type ToolExecutionResult = {
    content: string;
    images?: readonly LlmImageContent[];
    data: ToolCallViewData;
    isError: boolean;
    endReason: ToolCallEndReason;
    task?: ToolTaskSnapshot;
};

export type ToolOutputHandler = (delta: ToolCallOutputDelta) => void;

export type ToolTaskEvent =
    | { type: "backgroundTask.start"; task: ToolTaskSnapshot }
    | {
        type: "backgroundTask.output";
        taskId: string;
        output: string;
        truncatedCharacters: number;
    }
    | { type: "backgroundTask.end"; task: ToolTaskState }
    | { type: "backgroundTask.consume"; task: ToolTaskState }
    | { type: "backgroundTask.discard"; task: ToolTaskState };

export type ToolBackgroundEnd = {
    taskId: string;
    exitCode: number | null;
    error: string | null;
    unreadOutput: string;
    data: ToolCallViewData;
    isError: boolean;
};

export type ToolBackgroundEndHandler = (result: ToolBackgroundEnd) => void;

export type ToolTaskEventHandler = (event: ToolTaskEvent) => void;

export type ToolEndEvent = {
    type: "tool.end";
    toolCallId: string;
    toolName: string;
    data: ToolCallViewData;
    isError: boolean;
    endReason: ToolCallEndReason;
};

export type ToolStopEvent = ToolEndEvent | ToolTaskEvent;

export type ToolExecutionObserver = {
    onOutput: ToolOutputHandler;
    onBackgroundEnd?: ToolBackgroundEndHandler;
    onTaskEvent?: ToolTaskEventHandler;
    requestPermission?: (request: PermissionGrantInput) => Promise<PermissionDecision>;
};

export type ToolExecutor = {
    readonly definitions: readonly LlmToolDefinition[];
    getRegisteredTools?(permission: PermissionMode): readonly LlmToolDefinition[];
    hasActiveWork?(): boolean;
    handles(name: string): boolean;
    execute(
        call: LlmToolCallBlock,
        observer: ToolExecutionObserver,
        signal?: AbortSignal
    ): Promise<ToolExecutionResult>;
    stop(): Promise<readonly ToolStopEvent[]>;
    dispose(): void;
};
