import type { ToolSandboxFactory } from "../../core/execution/sandbox.ts";
import {
    createPermissionRules,
    mergePermissionRules
} from "../../core/permissions/rules.ts";
import { SessionPermissions } from "../../core/permissions/session-permissions.ts";
import type { ToolManager } from "./tool-manager.ts";
import { toolFromExecutor } from "./tool-manager.ts";
import { createDefaultTools } from "./default-tools.ts";
import { ShellSessionBudget } from "./shell/shell.ts";

export const DEFAULT_TOOL_MANAGER_ID = "jarvix.default";

export type DefaultToolManagerOptions = {
    permissions: SessionPermissions;
    sandboxFactory?: ToolSandboxFactory;
    sharedBudget: ShellSessionBudget;
};

export function createDefaultToolManager(
    options: DefaultToolManagerOptions
): ToolManager {
    return {
        id: DEFAULT_TOOL_MANAGER_ID,
        create(context) {
            const sandbox = options.sandboxFactory?.({
                permissionRules: () => mergePermissionRules(
                    createPermissionRules(
                        context.permission(),
                        context.workingDirectories()
                    ),
                    options.permissions.grants()
                )
            });
            return [toolFromExecutor(createDefaultTools({
                shell: {
                    defaultCwd: () => context.workingDirectories()[0],
                    sandbox: sandbox?.command,
                    sharedBudget: options.sharedBudget
                },
                applyPatch: {
                    defaultCwd: () => context.workingDirectories()[0],
                    sandbox: sandbox?.access
                },
                requestPermission: {
                    sandboxActive: sandbox
                        ? () => sandbox.active
                        : undefined
                },
                viewImage: {
                    defaultCwd: () => context.workingDirectories()[0],
                    sandbox: sandbox?.access
                }
            }))];
        }
    };
}
