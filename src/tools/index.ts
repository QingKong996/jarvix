import { ApplyPatchTool, APPLY_PATCH_TOOL, APPLY_PATCH_TOOL_DEFINITIONS } from "./apply-patch.ts";
import { BackgroundTaskManager } from "./background-task-manager.ts";
import { ToolRegistry } from "./tool-registry.ts";
import type { ToolExecutor } from "./types.ts";

export { ApplyPatchTool, APPLY_PATCH_TOOL, APPLY_PATCH_TOOL_DEFINITIONS } from "./apply-patch.ts";
export { BackgroundTaskManager } from "./background-task-manager.ts";
export { ShellTool, SHELL_TOOL_DEFINITIONS } from "./shell.ts";
export { ToolRegistry } from "./tool-registry.ts";
export type {
    ToolBackgroundEnd,
    ToolBackgroundEndHandler,
    ToolCallEndReason,
    ToolExecutionResult,
    ToolExecutionObserver,
    ToolExecutor,
    ToolOutputHandler,
    ToolTaskEvent,
    ToolTaskEventHandler,
    ToolTaskState,
    ToolTaskSnapshot
} from "./types.ts";
export type {
    ApplyPatchView,
    GenericToolView,
    ShellExecCommandView,
    ShellWriteStdinView,
    ToolCallOutputDelta,
    ToolCallStatus,
    ToolCallViewData
} from "./view.ts";

/** Build the tool set available to a standard Jarvix conversation. */
export function createDefaultTools(): ToolExecutor {
    return new ToolRegistry([
        new BackgroundTaskManager(),
        new ApplyPatchTool()
    ]);
}
