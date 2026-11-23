import { ApplyPatchTool, type ApplyPatchToolOptions } from "./apply-patch/apply-patch.ts";
import { BackgroundTaskManager } from "./shell/background-task-manager.ts";
import { ShellTool, type ShellToolOptions } from "./shell/shell.ts";
import { LocalTimeTool, SleepTool } from "./time/time.ts";
import {
    RequestPermissionTool,
    type RequestPermissionToolOptions
} from "./request-permission/request-permission.ts";
import { ToolRegistry } from "./tool-registry.ts";
import type { ToolExecutor } from "./types.ts";

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
