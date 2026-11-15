import type { LlmToolCallBlock, LlmToolDefinition } from "../llm/types.ts";
import type { ToolCallOutputDelta, ToolCallViewData } from "./view.ts";

export type ToolCallEndReason = "exited" | "background";

export type ToolTaskState = {
    id: string;
    kind: "shell";
    command: string;
    cwd: string;
    status: "running" | "completed" | "failed";
    exitCode: number | null;
    error: string | null;
    unreadCharacters: number;
};

export type ToolTaskSnapshot = ToolTaskState & {
    output: string;
};

export type ToolExecutionResult = {
    content: string;
    data: ToolCallViewData;
    isError: boolean;
    endReason: ToolCallEndReason;
    task?: ToolTaskSnapshot;
};

export type ToolOutputHandler = (delta: ToolCallOutputDelta) => void;

export type ToolTaskEvent =
    | { type: "backgroundTask.start"; task: ToolTaskSnapshot }
    | { type: "backgroundTask.output"; taskId: string; output: string }
    | { type: "backgroundTask.end"; task: ToolTaskState }
    | { type: "backgroundTask.consume"; task: ToolTaskState };

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

export type ToolExecutionObserver = {
    onOutput: ToolOutputHandler;
    onBackgroundEnd?: ToolBackgroundEndHandler;
    onTaskEvent?: ToolTaskEventHandler;
};

export type ToolExecutor = {
    readonly definitions: readonly LlmToolDefinition[];
    handles(name: string): boolean;
    execute(
        call: LlmToolCallBlock,
        observer: ToolExecutionObserver,
        signal?: AbortSignal
    ): Promise<ToolExecutionResult>;
    dispose(): void;
};
