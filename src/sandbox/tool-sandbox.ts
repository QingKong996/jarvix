import {
    parseWindowsSandboxError,
    type WindowsBinShell
} from "@anthropic-ai/sandbox-runtime";
import type {
    CommandSandbox,
    PathAccessGuard,
    SandboxReadiness,
    SandboxShell,
    SandboxedCommand,
    ToolSandbox,
    ToolSandboxContext,
    ToolSandboxFactory
} from "../core/execution/sandbox.ts";
import { authorizeSandboxRead, authorizeSandboxWrite } from "./access.ts";
import {
    createSandboxLaunch,
    preflightSandbox,
    SandboxRunnerHost,
    type SandboxLaunch
} from "./launch.ts";
import { createSandboxPolicy } from "./policy.ts";

export type ToolSandboxAdapterOptions = {
    preflight?: () => Promise<SandboxReadiness>;
    runnerPath?: string;
};

export function createToolSandboxFactory(
    options: ToolSandboxAdapterOptions = {}
): ToolSandboxFactory {
    return (context) => createToolSandbox(context, options);
}

export function createToolSandbox(
    context: ToolSandboxContext,
    options: ToolSandboxAdapterOptions = {}
): ToolSandbox {
    const preflight = options.preflight ?? preflightSandbox;
    let host: SandboxRunnerHost | undefined;
    const policy = () => createSandboxPolicy(context.permissionRules());

    const command: CommandSandbox = {
        get active() {
            return policy() !== null;
        },
        preflight,
        async prepareCommand(input, signal) {
            const current = policy();
            if (current === null) {
                return null;
            }
            host ??= new SandboxRunnerHost({
                runnerPath: options.runnerPath
            });
            const launch = await createSandboxLaunch(host, {
                command: input.command,
                cwd: input.cwd,
                commandId: input.commandId,
                policy: current,
                binShell: toSandboxBinShell(input.binShell)
            }, signal);
            return toSandboxedCommand(launch);
        },
        dispose() {
            host?.dispose();
            host = undefined;
        }
    };

    const access: PathAccessGuard = {
        authorizeRead(path) {
            return authorizeSandboxRead(policy(), path);
        },
        authorizeWrites(paths) {
            return paths.map((path) => authorizeSandboxWrite(policy(), path));
        }
    };

    return {
        get active() {
            return policy() !== null;
        },
        command,
        access
    };
}

function toSandboxedCommand(launch: SandboxLaunch): SandboxedCommand {
    return {
        commandId: launch.commandId,
        command: launch.launch.command,
        args: launch.launch.args,
        env: launch.launch.env,
        onViolations: launch.onViolations,
        complete: launch.complete,
        cleanup: launch.cleanup,
        explainExitError
    };
}

function toSandboxBinShell(
    shell: SandboxShell | undefined
): string | WindowsBinShell | undefined {
    if (typeof shell === "string" || shell === undefined) {
        return shell;
    }
    return {
        exe: shell.exe,
        args: [...shell.args]
    };
}

function explainExitError(
    exitCode: number | null,
    output: string
): string | null {
    if (process.platform !== "win32" || exitCode !== 16) {
        return null;
    }
    const launchError = parseWindowsSandboxError(output);
    if (launchError?.code !== "mapped_drive_cwd") {
        return null;
    }
    return [
        "The Windows sandbox could not start with this working directory.",
        "The sandbox account may not be able to access it, or it may be on a mapped network drive.",
        "Use a local working directory inside the session's readable roots."
    ].join(" ");
}
