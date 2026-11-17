import { ApplyPatchTool } from "./apply-patch.ts";
import { BackgroundTaskManager } from "./background-task-manager.ts";
import { LocalTimeTool, SleepTool } from "./time.ts";
import { ToolRegistry } from "./tool-registry.ts";
import type { ToolExecutor } from "./types.ts";

export { ApplyPatchTool, APPLY_PATCH_TOOL, APPLY_PATCH_TOOL_DEFINITIONS } from "./apply-patch.ts";
export { BackgroundTaskManager } from "./background-task-manager.ts";
export { ShellTool, SHELL_TOOL_DEFINITIONS } from "./shell.ts";
export {
    LOCAL_TIME_TOOL,
    LOCAL_TIME_TOOL_DEFINITIONS,
    LocalTimeTool,
    SLEEP_TOOL,
    SLEEP_TOOL_DEFINITIONS,
    SleepTool
} from "./time.ts";
export { ToolRegistry } from "./tool-registry.ts";
export type {
    ToolBackgroundEnd,
    ToolBackgroundEndHandler,
    ToolCallEndReason,
    ToolEndEvent,
    ToolExecutionResult,
    ToolExecutionObserver,
    ToolExecutor,
    ToolOutputHandler,
    ToolStopEvent,
    ToolTaskEvent,
    ToolTaskEventHandler,
    ToolTaskState,
    ToolTaskSnapshot
} from "./types.ts";
export type {
    ApplyPatchView,
    GenericToolView,
    LocalTimeView,
    ShellExecCommandView,
    ShellWriteStdinView,
    SleepView,
    ToolCallOutputDelta,
    ToolCallStatus,
    ToolCallViewData
} from "./view.ts";

/** Build the tool set available to a standard Jarvix conversation. */
export function createDefaultTools(): ToolExecutor {
    return new ToolRegistry([
        new BackgroundTaskManager(),
        new ApplyPatchTool(),
        new LocalTimeTool(),
        new SleepTool()
    ]);
}
