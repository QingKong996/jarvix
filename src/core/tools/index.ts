import { ApplyPatchTool, type ApplyPatchToolOptions } from "./apply-patch/apply-patch.ts";
import { BackgroundTaskManager } from "./shell/background-task-manager.ts";
import { ShellTool, type ShellToolOptions } from "./shell/shell.ts";
import { LocalTimeTool, SleepTool } from "./time/time.ts";
import {
    RequestPermissionTool,
    type RequestPermissionToolOptions
} from "./request-permission/request-permission.ts";
import { ToolRegistry } from "./shared/tool-registry.ts";
import type { ToolExecutor } from "./shared/types.ts";

export {
    ApplyPatchTool,
    APPLY_PATCH_TOOL,
    APPLY_PATCH_TOOL_DEFINITIONS
} from "./apply-patch/apply-patch.ts";
export { BackgroundTaskManager } from "./shell/background-task-manager.ts";
export {
    SHELL_TOOL_DEFINITIONS,
    ShellSessionBudget,
    ShellTool
} from "./shell/shell.ts";
export {
    REQUEST_PERMISSION_TOOL,
    REQUEST_PERMISSION_TOOL_DEFINITIONS,
    RequestPermissionTool
} from "./request-permission/request-permission.ts";
export {
    LOCAL_TIME_TOOL,
    LOCAL_TIME_TOOL_DEFINITIONS,
    LocalTimeTool,
    SLEEP_TOOL,
    SLEEP_TOOL_DEFINITIONS,
    SleepTool
} from "./time/time.ts";
export { ToolRegistry } from "./shared/tool-registry.ts";
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
} from "./shared/types.ts";
export type {
    ApplyPatchView,
    GenericToolView,
    LocalTimeView,
    PermissionRequestView,
    ShellExecCommandView,
    ShellWriteStdinView,
    SleepView,
    ToolCallOutputDelta,
    ToolCallStatus,
    ToolCallViewData
} from "./view.ts";

export type DefaultToolsOptions = {
    shell?: ShellToolOptions;
    applyPatch?: ApplyPatchToolOptions;
    requestPermission?: RequestPermissionToolOptions;
};

/** Build the tool set available to a standard Jarvix conversation. */
export function createDefaultTools(options: DefaultToolsOptions = {}): ToolExecutor {
    return new ToolRegistry([
        new BackgroundTaskManager(new ShellTool(options.shell)),
        new ApplyPatchTool(options.applyPatch),
        new RequestPermissionTool(options.requestPermission),
        new LocalTimeTool(),
        new SleepTool()
    ]);
}
