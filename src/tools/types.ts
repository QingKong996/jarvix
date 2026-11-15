import type { LlmToolCallBlock, LlmToolDefinition } from "../llm/types.ts";
import type { ToolCallOutputDelta, ToolCallViewData } from "./view.ts";

export type ToolExecutionResult = {
    content: string;
    data: ToolCallViewData;
    isError: boolean;
    /** Internal id for a task that remains addressable after the tool call returns. */
    taskId?: string;
};

export type ToolOutputHandler = (delta: ToolCallOutputDelta) => void;

export type ToolBackgroundEnd = {
    taskId: string;
    exitCode: number | null;
    error: string | null;
    unreadOutput: string;
    data: ToolCallViewData;
    isError: boolean;
};

export type ToolBackgroundEndHandler = (result: ToolBackgroundEnd) => void;

export type ToolExecutor = {
    readonly definitions: readonly LlmToolDefinition[];
    handles(name: string): boolean;
    execute(
        call: LlmToolCallBlock,
        onOutput: ToolOutputHandler,
        signal?: AbortSignal,
        onBackgroundEnd?: ToolBackgroundEndHandler
    ): Promise<ToolExecutionResult>;
    dispose(): void;
};
