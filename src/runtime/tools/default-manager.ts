import type { SandboxPreflight } from "../../core/permissions/sandbox-launch.ts";
import { SessionPermissions } from "../../core/permissions/session-permissions.ts";
import { createSandboxPolicy } from "../../core/permissions/sandbox.ts";
import type { ToolManager } from "./tool-manager.ts";
import { toolFromExecutor } from "./tool-manager.ts";
import { createDefaultTools } from "./default-tools.ts";
import { ShellSessionBudget } from "./shell/shell.ts";

export const DEFAULT_TOOL_MANAGER_ID = "jarvix.default";

export type DefaultToolManagerOptions = {
    permissions: SessionPermissions;
    sandboxPreflight?: SandboxPreflight;
    sharedBudget: ShellSessionBudget;
};

export function createDefaultToolManager(
    options: DefaultToolManagerOptions
): ToolManager {
    return {
        id: DEFAULT_TOOL_MANAGER_ID,
        create(context) {
            const sandboxPolicy = () => options.permissions.apply(createSandboxPolicy(
                context.permission(),
                context.workingDirectories()
            ));
            return [toolFromExecutor(createDefaultTools({
                shell: {
                    defaultCwd: () => context.workingDirectories()[0],
                    sandboxPolicy,
                    sandboxPreflight: options.sandboxPreflight,
                    sharedBudget: options.sharedBudget
                },
                applyPatch: {
                    defaultCwd: () => context.workingDirectories()[0],
                    sandboxPolicy
                },
                requestPermission: {
                    sandboxPolicy
                }
            }))];
        }
    };
}
