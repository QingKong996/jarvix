import {
    SandboxManager,
    SandboxRuntimeConfigSchema,
    type SandboxRuntimeConfig
} from "@anthropic-ai/sandbox-runtime";
import type {
    SandboxRunnerLaunch,
    SandboxRunnerMessage,
    SandboxRunnerRequest,
    SandboxRunnerViolation
} from "./protocol.ts";
import { rememberSandboxViolation } from "../core/permissions/violations.ts";

if (process.env.JARVIX_SANDBOX_RUNNER === "1") {
    void runSandboxRunner().catch((error: unknown) => {
        process.stderr.write(`Sandbox runner failed: ${errorMessage(error)}\n`);
        process.exit(1);
    });
}

type ActiveCommand = {
    seenViolations: Set<string>;
};

async function runSandboxRunner(): Promise<void> {
    let initialization: Promise<void> | undefined;
    let initializedConfigKey: string | undefined;
    let shuttingDown = false;
    const activeCommands = new Map<string, ActiveCommand>();
    const store = SandboxManager.getSandboxViolationStore();

    const flush = (commandId: string): SandboxRunnerViolation[] => {
        const command = activeCommands.get(commandId);
        if (!command) {
            return [];
        }
        const violations = store.getViolationsForCommand(commandId)
            .filter((violation) => {
                const signature = violationSignature(violation);
                return rememberSandboxViolation(
                    command.seenViolations,
                    signature
                );
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
        return violations;
    };

    const unsubscribe = store.subscribe(() => {
        for (const commandId of activeCommands.keys()) {
            flush(commandId);
        }
    });

    const ensureInitialized = (config: SandboxRuntimeConfig): Promise<void> => {
        const configKey = JSON.stringify(config);
        if (initialization) {
            if (initializedConfigKey !== configKey) {
                return Promise.reject(new Error(
                    "The sandbox runner cannot change policy while it is running."
                ));
            }
            return initialization;
        }
        initializedConfigKey = configKey;
        initialization = SandboxManager.initialize(
            SandboxRuntimeConfigSchema.parse(config)
        ).catch((error: unknown) => {
            initialization = undefined;
            initializedConfigKey = undefined;
            throw error;
        });
        return initialization;
    };

    const shutdown = async (requestId?: string): Promise<void> => {
        if (shuttingDown) {
            return;
        }
        shuttingDown = true;
        unsubscribe();
        try {
            await SandboxManager.reset();
        } catch {
            // The host is shutting down; never mask a command result here.
        }
        if (requestId) {
            await acknowledgeShutdown(requestId);
        }
        try {
            process.disconnect();
        } catch {
            // The parent may already have disconnected.
        }
        process.exit(0);
    };

    process.on("message", (value: unknown) => {
        void handle(value);
    });
    process.once("disconnect", () => {
        void shutdown();
    });
    process.once("SIGTERM", () => {
        void shutdown();
    });
    process.once("SIGINT", () => {
        void shutdown();
    });

    async function handle(value: unknown): Promise<void> {
        if (!isRequest(value)) {
            return;
        }
        if (value.type === "shutdown") {
            await shutdown(value.requestId);
            return;
        }
        if (value.type === "complete") {
            const violations = flush(value.commandId);
            activeCommands.delete(value.commandId);
            if (activeCommands.size === 0) {
                try {
                    SandboxManager.cleanupAfterCommand();
                } catch {
                    // Cleanup must not change the command's exit result.
                }
            }
            sendMessage({
                type: "completed",
                requestId: value.requestId,
                commandId: value.commandId,
                violations
            });
            return;
        }

        try {
            await ensureInitialized(value.config);
            const launch = await sandboxLaunch(value);
            activeCommands.set(value.commandId, {
                seenViolations: new Set()
            });
            sendMessage({
                type: "prepared",
                requestId: value.requestId,
                commandId: value.commandId,
                launch
            });
        } catch (error) {
            sendMessage({
                type: "error",
                requestId: value.requestId,
                message: errorMessage(error)
            });
        }
    }
}

async function sandboxLaunch(
    request: Extract<SandboxRunnerRequest, { type: "prepare" }>
): Promise<SandboxRunnerLaunch> {
    const wrapped = await SandboxManager.wrapWithSandboxArgv(
        request.command,
        request.binShell,
        undefined,
        undefined,
        request.cwd,
        {
            commandId: request.commandId,
            commandText: request.command
        }
    );
    if (!wrapped.argv[0]) {
        throw new Error("The sandbox returned an empty command.");
    }
    return {
        command: wrapped.argv[0],
        args: wrapped.argv.slice(1),
        env: wrapped.env
    };
}

function isRequest(value: unknown): value is SandboxRunnerRequest {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const request = value as Record<string, unknown>;
    return (
        typeof request.requestId === "string"
        && (
            request.type === "prepare"
            || request.type === "complete"
            || request.type === "shutdown"
        )
    );
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

function acknowledgeShutdown(requestId: string): Promise<void> {
    if (!process.send) {
        return Promise.resolve();
    }
    return new Promise((resolvePromise) => {
        try {
            process.send!({
                type: "shutdown",
                requestId
            }, () => resolvePromise());
        } catch {
            resolvePromise();
        }
    });
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
