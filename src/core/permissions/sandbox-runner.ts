import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import {
    SandboxManager,
    SandboxRuntimeConfigSchema
} from "@anthropic-ai/sandbox-runtime";
import type {
    SandboxRunnerInvocation,
    SandboxRunnerMessage
} from "./sandbox-protocol.ts";
import { rememberSandboxViolation } from "./violations.ts";

if (process.env.JARVIX_SANDBOX_RUNNER === "1") {
    void runSandboxRunner(process.argv[2]).catch((error: unknown) => {
        process.stderr.write(`Sandbox runner failed: ${errorMessage(error)}\n`);
        process.exit(1);
    });
}

async function runSandboxRunner(invocationPath: string | undefined): Promise<void> {
    if (!invocationPath) {
        throw new Error("Missing sandbox invocation path.");
    }

    const invocation = JSON.parse(
        readFileSync(invocationPath, "utf8")
    ) as SandboxRunnerInvocation;
    const config = SandboxRuntimeConfigSchema.parse(invocation.config);
    const commandId = invocation.commandId;
    let finished = false;
    let child: ChildProcess | null = null;
    let unsubscribe: (() => void) | undefined;

    const store = SandboxManager.getSandboxViolationStore();
    const seenViolations = new Set<string>();
    const flushViolations = (): void => {
        const violations = store.getViolationsForCommand(commandId)
            .filter((violation) => {
                const signature = violationSignature(violation);
                return rememberSandboxViolation(seenViolations, signature);
            })
            .map((violation) => ({
                line: violation.line,
                command: violation.command,
                timestamp: violation.timestamp.getTime()
            }));
        if (violations.length > 0) {
            sendMessage({
                type: "violations",
                commandId,
                violations
            });
        }
    };

    const finish = (exitCode: number | null): void => {
        if (finished) {
            return;
        }
        finished = true;
        flushViolations();
        unsubscribe?.();
        try {
            SandboxManager.cleanupAfterCommand();
        } catch {
            // The runner is exiting; cleanup errors must not mask the command result.
        }
        try {
            process.stdin.unpipe();
        } catch {
            // The parent may already have closed stdin.
        }

        const done: SandboxRunnerMessage = {
            type: "done",
            commandId,
            exitCode
        };
        const processExitCode = exitCode ?? 1;
        if (!process.send) {
            process.exit(processExitCode);
            return;
        }
        try {
            process.send(done, () => {
                try {
                    process.disconnect();
                } catch {
                    // The parent may have already disconnected.
                }
                process.exit(processExitCode);
            });
        } catch {
            process.exit(processExitCode);
        }
        setTimeout(() => process.exit(processExitCode), 250).unref();
    };

    try {
        await SandboxManager.initialize(config);
        const launch = await sandboxLaunch(invocation, commandId);
        unsubscribe = store.subscribe(flushViolations);
        child = spawn(launch.command, launch.args, {
            cwd: invocation.cwd,
            env: launch.env,
            stdio: ["pipe", "inherit", "inherit"],
            shell: launch.shell,
            windowsHide: true,
            detached: false
        });
    } catch (error) {
        process.stderr.write(`Failed to start sandboxed command: ${errorMessage(error)}\n`);
        finish(1);
        return;
    }

    child.stdin?.on("error", () => {
        // The command may exit without reading stdin.
    });
    process.stdin.on("error", () => {
        // The parent may close the pipe after the command exits.
    });
    if (child.stdin) {
        process.stdin.pipe(child.stdin);
    }

    child.once("error", (error) => {
        process.stderr.write(`Failed to execute command: ${error.message}\n`);
        finish(1);
    });
    child.once("close", (code) => {
        try {
            process.stdin.unpipe();
        } catch {
            // The pipe may already be gone.
        }
        finish(code);
    });
}

async function sandboxLaunch(
    invocation: SandboxRunnerInvocation,
    commandId: string
): Promise<{
    command: string;
    args: string[];
    env: NodeJS.ProcessEnv;
    shell: boolean;
}> {
    if (process.platform === "win32") {
        const wrapped = await SandboxManager.wrapWithSandboxArgv(
            invocation.command,
            invocation.binShell,
            undefined,
            undefined,
            invocation.cwd,
            {
                commandId,
                commandText: invocation.command
            }
        );
        return {
            command: wrapped.argv[0]!,
            args: wrapped.argv.slice(1),
            env: wrapped.env,
            shell: false
        };
    }

    const wrapped = await SandboxManager.wrapWithSandbox(
        invocation.command,
        typeof invocation.binShell === "string" ? invocation.binShell : undefined,
        undefined,
        undefined,
        {
            commandId,
            commandText: invocation.command
        }
    );
    return {
        command: wrapped,
        args: [],
        env: process.env,
        shell: true
    };
}

function sendMessage(message: SandboxRunnerMessage): void {
    if (!process.send) {
        return;
    }
    try {
        process.send(message);
    } catch {
        // A closed parent channel means there is nowhere left to report.
    }
}

function violationSignature(violation: {
    line: string;
    command?: string;
    timestamp: Date;
}): string {
    return `${violation.timestamp.getTime()}\u0000${violation.line}\u0000${violation.command ?? ""}`;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
