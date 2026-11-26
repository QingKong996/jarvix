import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
    copyFileSync,
    mkdirSync,
    statSync
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    checkWindowsDependenciesAsync,
    getWindowsProfileReadStatusAsync,
    installWindowsSandboxAsync,
    resolveSrtWin,
    type SandboxDependencyCheck,
    type SandboxRuntimeConfig,
    type SrtWinSpawn,
    type WindowsBinShell,
    type WindowsProfileGrantStatus
} from "@anthropic-ai/sandbox-runtime";
import {
    isSandboxRunnerMessage,
    type SandboxRunnerLaunch,
    type SandboxRunnerMessage,
    type SandboxRunnerRequest,
    type SandboxRunnerViolation
} from "./sandbox-protocol.ts";
import type { SandboxPolicy } from "./sandbox.ts";

const SANDBOX_REQUIRE = createRequire(import.meta.url);
const WINDOWS_HELPER_DIRECTORY = "JarvixSandbox";
const WINDOWS_HELPER_NAME = "srt-win.exe";
const RUNNER_REQUEST_TIMEOUT_MS = 600_000;
const RUNNER_SHUTDOWN_TIMEOUT_MS = 5_000;

let windowsHelperAccessPrepared = false;

export type SandboxLaunch = {
    launch: SandboxRunnerLaunch;
    commandId: string;
    onViolations(
        listener: (violations: readonly SandboxRunnerViolation[]) => void
    ): () => void;
    complete(): Promise<readonly SandboxRunnerViolation[]>;
    cleanup(): void;
};

export type SandboxLaunchOptions = {
    command: string;
    cwd: string;
    commandId: string;
    policy: SandboxPolicy;
    binShell?: string | WindowsBinShell;
};

export type SandboxPreflightResult =
    | {
        ready: true;
        warnings: readonly string[];
    }
    | {
        ready: false;
        errors: readonly string[];
        warnings: readonly string[];
    };

export type SandboxPreflight = () => Promise<SandboxPreflightResult>;

export type SandboxProfileReadiness = () => Promise<boolean>;

export type SandboxProfileReadinessOptions = {
    platform?: NodeJS.Platform;
    resolveSpawn?: () => SrtWinSpawn;
    checkProfile?: (
        srtWin: SrtWinSpawn
    ) => Promise<Pick<WindowsProfileGrantStatus, "state">>;
};

export type SandboxInstallResult = {
    status: "installed" | "cancelled" | "not-required";
};

export type SandboxPreflightOptions = {
    platform?: NodeJS.Platform;
    resolveSpawn?: () => SrtWinSpawn;
    checkDependencies?: (srtWin: SrtWinSpawn) => Promise<SandboxDependencyCheck>;
};

export type SandboxInstallOptions = {
    platform?: NodeJS.Platform;
    resolveSpawn?: () => SrtWinSpawn;
    install?: (srtWin: SrtWinSpawn) => Promise<{ cancelled?: true }>;
};

type PendingRequest = {
    resolve(message: SandboxRunnerMessage): void;
    reject(error: Error): void;
    timer: NodeJS.Timeout;
};

type RunnerCommand = {
    commandId: string;
    connection: RunnerConnection;
    listener: ((violations: readonly SandboxRunnerViolation[]) => void) | null;
    pendingViolations: SandboxRunnerViolation[];
    completion: Promise<readonly SandboxRunnerViolation[]> | null;
};

type RunnerConnection = {
    key: string;
    child: ChildProcess;
    pending: Map<string, PendingRequest>;
    commands: Map<string, RunnerCommand>;
    output: string;
    failure: Error | null;
    closing: boolean;
};

/**
 * Initializes one sandbox runtime per policy and keeps it alive while commands
 * run. Commands themselves stay independent child processes in the caller.
 */
export class SandboxRunnerHost {
    private readonly runnerPath: string;
    private readonly connections = new Map<string, RunnerConnection>();
    private currentKey: string | null = null;
    private disposed = false;

    constructor(options: { runnerPath?: string } = {}) {
        this.runnerPath = options.runnerPath ?? defaultSandboxRunnerPath();
    }

    async prepare(options: SandboxLaunchOptions): Promise<SandboxLaunch> {
        if (this.disposed) {
            throw new Error("The sandbox runner has been disposed.");
        }

        const config = sandboxRuntimeConfig(options.policy);
        const key = JSON.stringify(config);
        const connection = this.connectionFor(key);
        this.currentKey = key;
        this.closeInactiveConnections(key);

        if (connection.commands.has(options.commandId)) {
            throw new Error(`Sandbox command already prepared: ${options.commandId}`);
        }

        const command: RunnerCommand = {
            commandId: options.commandId,
            connection,
            listener: null,
            pendingViolations: [],
            completion: null
        };
        connection.commands.set(options.commandId, command);

        const requestId = randomUUID();
        let response: SandboxRunnerMessage;
        try {
            response = await this.request(connection, {
                type: "prepare",
                requestId,
                config,
                command: options.command,
                commandId: options.commandId,
                cwd: options.cwd,
                binShell: options.binShell
            });
        } catch (error) {
            connection.commands.delete(options.commandId);
            this.closeInactiveConnections(this.currentKey);
            throw error;
        }

        if (response.type !== "prepared") {
            connection.commands.delete(options.commandId);
            this.closeInactiveConnections(this.currentKey);
            throw this.responseError(response, "prepare");
        }

        return {
            launch: response.launch,
            commandId: options.commandId,
            onViolations: (listener) => {
                command.listener = listener;
                if (command.pendingViolations.length > 0) {
                    listener(command.pendingViolations.splice(0));
                }
                return () => {
                    if (command.listener === listener) {
                        command.listener = null;
                    }
                };
            },
            complete: () => this.complete(command),
            cleanup: () => {
                void this.complete(command).catch(() => undefined);
            }
        };
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        for (const connection of [...this.connections.values()]) {
            this.closeConnection(connection);
        }
        this.connections.clear();
    }

    private connectionFor(key: string): RunnerConnection {
        const existing = this.connections.get(key);
        if (existing && !existing.closing && existing.failure === null) {
            return existing;
        }
        if (existing) {
            this.connections.delete(key);
        }

        const child = spawn(process.execPath, [this.runnerPath], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                ELECTRON_RUN_AS_NODE: "1",
                JARVIX_SANDBOX_RUNNER: "1"
            },
            stdio: ["ignore", "pipe", "pipe", "ipc"],
            windowsHide: true
        });
        const connection: RunnerConnection = {
            key,
            child,
            pending: new Map(),
            commands: new Map(),
            output: "",
            failure: null,
            closing: false
        };
        this.connections.set(key, connection);
        this.observe(connection);
        return connection;
    }

    private observe(connection: RunnerConnection): void {
        connection.child.stdout?.setEncoding("utf8");
        connection.child.stderr?.setEncoding("utf8");
        connection.child.stdout?.on("data", (chunk: string) => {
            connection.output = appendTail(connection.output, chunk);
        });
        connection.child.stderr?.on("data", (chunk: string) => {
            connection.output = appendTail(connection.output, chunk);
        });
        connection.child.on("message", (message: unknown) => {
            this.receive(connection, message);
        });
        connection.child.once("error", (error) => {
            this.failConnection(connection, error);
        });
        connection.child.once("exit", (code, signal) => {
            const reason = signal
                ? `signal ${signal}`
                : `exit code ${code ?? "unknown"}`;
            this.failConnection(
                connection,
                new Error(`The sandbox runner stopped with ${reason}.${this.outputSuffix(connection)}`)
            );
        });
    }

    private receive(connection: RunnerConnection, value: unknown): void {
        if (!isSandboxRunnerMessage(value)) {
            return;
        }
        if (value.type === "violations") {
            this.deliver(
                connection,
                value.commandId,
                value.violations
            );
            return;
        }
        if (value.type === "shutdown") {
            this.resolvePending(connection, value.requestId, value);
            return;
        }
        this.resolvePending(connection, value.requestId, value);
        if (value.type === "error") {
            return;
        }
        if (value.type === "completed") {
            this.deliver(
                connection,
                value.commandId,
                value.violations
            );
        }
    }

    private request(
        connection: RunnerConnection,
        message: SandboxRunnerRequest
    ): Promise<SandboxRunnerMessage> {
        if (connection.failure) {
            return Promise.reject(connection.failure);
        }
        if (connection.closing || !connection.child.connected) {
            return Promise.reject(new Error("The sandbox runner is not connected."));
        }

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                connection.pending.delete(message.requestId);
                const error = new Error("The sandbox runner request timed out.");
                this.stopConnection(
                    connection,
                    error
                );
                reject(error);
            }, RUNNER_REQUEST_TIMEOUT_MS);
            connection.pending.set(message.requestId, {
                resolve,
                reject,
                timer
            });
            try {
                connection.child.send(message, (error) => {
                    if (!error) {
                        return;
                    }
                    const pending = connection.pending.get(message.requestId);
                    if (!pending) {
                        return;
                    }
                    connection.pending.delete(message.requestId);
                    clearTimeout(pending.timer);
                    pending.reject(error);
                });
            } catch (error) {
                connection.pending.delete(message.requestId);
                clearTimeout(timer);
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    private resolvePending(
        connection: RunnerConnection,
        requestId: string,
        message: SandboxRunnerMessage
    ): void {
        const pending = connection.pending.get(requestId);
        if (!pending) {
            return;
        }
        connection.pending.delete(requestId);
        clearTimeout(pending.timer);
        pending.resolve(message);
    }

    private deliver(
        connection: RunnerConnection,
        commandId: string,
        violations: readonly SandboxRunnerViolation[]
    ): void {
        if (violations.length === 0) {
            return;
        }
        const command = connection.commands.get(commandId);
        if (!command) {
            return;
        }
        if (command.listener) {
            command.listener(violations);
        } else {
            command.pendingViolations.push(...violations);
        }
    }

    private complete(
        command: RunnerCommand
    ): Promise<readonly SandboxRunnerViolation[]> {
        if (command.completion) {
            return command.completion;
        }
        command.completion = (async () => {
            const response = await this.request(command.connection, {
                type: "complete",
                requestId: randomUUID(),
                commandId: command.commandId
            });
            if (response.type !== "completed") {
                throw this.responseError(response, "complete");
            }
            this.deliver(
                command.connection,
                command.commandId,
                response.violations
            );
            return response.violations;
        })().finally(() => {
            command.connection.commands.delete(command.commandId);
            this.closeInactiveConnections(this.currentKey);
        });
        return command.completion;
    }

    private closeInactiveConnections(currentKey: string | null): void {
        for (const [key, connection] of [...this.connections]) {
            if (
                key !== currentKey
                && connection.commands.size === 0
                && !connection.closing
            ) {
                this.closeConnection(connection);
            }
        }
    }

    private closeConnection(connection: RunnerConnection): void {
        if (connection.closing) {
            return;
        }
        connection.closing = true;
        this.connections.delete(connection.key);
        if (!connection.child.connected) {
            this.stopConnection(connection);
            return;
        }
        const requestId = randomUUID();
        const timer = setTimeout(() => {
            this.stopConnection(connection);
        }, RUNNER_SHUTDOWN_TIMEOUT_MS);
        connection.pending.set(requestId, {
            resolve: () => {
                clearTimeout(timer);
                this.stopConnection(connection);
            },
            reject: () => {
                clearTimeout(timer);
                this.stopConnection(connection);
            },
            timer
        });
        try {
            connection.child.send({
                type: "shutdown",
                requestId
            } satisfies SandboxRunnerRequest);
        } catch {
            clearTimeout(timer);
            this.stopConnection(connection);
        }
    }

    private stopConnection(
        connection: RunnerConnection,
        error = new Error("The sandbox runner was shut down.")
    ): void {
        this.failConnection(connection, error);
        try {
            connection.child.kill();
        } catch {
            // The runner may already have exited.
        }
    }

    private failConnection(connection: RunnerConnection, error: Error): void {
        if (connection.failure === null) {
            connection.failure = error;
        }
        if (this.connections.get(connection.key) === connection) {
            this.connections.delete(connection.key);
        }
        const pendingRequests = [...connection.pending.values()];
        connection.pending.clear();
        for (const pending of pendingRequests) {
            clearTimeout(pending.timer);
            pending.reject(connection.failure);
        }
    }

    private responseError(
        response: SandboxRunnerMessage,
        operation: string
    ): Error {
        if (response.type === "error") {
            return new Error(response.message);
        }
        return new Error(`The sandbox runner returned an invalid ${operation} response.`);
    }

    private outputSuffix(connection: RunnerConnection): string {
        return connection.output.length > 0
            ? ` ${connection.output}`
            : "";
    }
}

export async function createSandboxLaunch(
    host: SandboxRunnerHost,
    options: SandboxLaunchOptions
): Promise<SandboxLaunch> {
    return host.prepare(options);
}

/** Build the cached preflight check for the platform sandbox dependencies. */
export function createSandboxPreflight(
    options: SandboxPreflightOptions = {}
): SandboxPreflight {
    const platform = options.platform ?? process.platform;
    const resolveSpawn = options.resolveSpawn ?? defaultWindowsSpawn;
    const checkDependencies = options.checkDependencies ?? ((srtWin) =>
        checkWindowsDependenciesAsync({ srtWin }));
    let windowsReady = false;

    return async () => {
        if (platform !== "win32" || windowsReady) {
            return { ready: true, warnings: [] };
        }

        try {
            const result = await checkDependencies(resolveSpawn());
            if (result.errors.length > 0) {
                return {
                    ready: false,
                    errors: result.errors,
                    warnings: result.warnings
                };
            }
            windowsReady = true;
            return {
                ready: true,
                warnings: result.warnings
            };
        } catch (error) {
            return {
                ready: false,
                errors: [errorMessage(error)],
                warnings: []
            };
        }
    };
}

export const preflightSandbox = createSandboxPreflight();

/** Whether the Windows sandbox profile read grant is complete and current. */
export function createSandboxProfileReadiness(
    options: SandboxProfileReadinessOptions = {}
): SandboxProfileReadiness {
    const platform = options.platform ?? process.platform;
    const resolveSpawn = options.resolveSpawn ?? defaultWindowsSpawn;
    const checkProfile = options.checkProfile ?? ((srtWin) =>
        getWindowsProfileReadStatusAsync({ srtWin }));

    return async () => {
        if (platform !== "win32") {
            return true;
        }
        try {
            const profile = await checkProfile(resolveSpawn());
            return profile.state === "current";
        } catch {
            return false;
        }
    };
}

export const sandboxProfileReady = createSandboxProfileReadiness();

export async function installSandbox(
    options: SandboxInstallOptions = {}
): Promise<SandboxInstallResult> {
    const platform = options.platform ?? process.platform;
    if (platform !== "win32") {
        return { status: "not-required" };
    }

    const resolveSpawn = options.resolveSpawn ?? defaultWindowsSpawn;
    const install = options.install ?? ((srtWin) =>
        installWindowsSandboxAsync({ srtWin }));
    const result = await install(resolveSpawn());
    return {
        status: result.cancelled ? "cancelled" : "installed"
    };
}

export function sandboxRuntimeConfig(policy: SandboxPolicy): SandboxRuntimeConfig {
    return {
        ...policy,
        ...(process.platform === "win32"
            ? { windows: { srtWin: { path: sandboxWindowsExecutable() } } }
            : {})
    };
}

function defaultSandboxRunnerPath(): string {
    return fileURLToPath(new URL("./sandbox-runner.js", import.meta.url));
}

function sandboxWindowsExecutable(): string {
    const arch = process.arch === "arm64" ? "arm64" : "x64";
    const packageDirectory = dirname(
        SANDBOX_REQUIRE.resolve("@anthropic-ai/sandbox-runtime/package.json")
    );
    const source = unpackedPath(
        join(packageDirectory, "vendor", "srt-win", arch, "srt-win.exe")
    );
    try {
        const directory = join(
            process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
            "Programs",
            WINDOWS_HELPER_DIRECTORY
        );
        const target = join(directory, WINDOWS_HELPER_NAME);
        mkdirSync(directory, { recursive: true });
        if (helperNeedsCopy(source, target)) {
            copyFileSync(source, target);
        }
        prepareWindowsHelperAccess(directory);
        return target;
    } catch {
        return source;
    }
}

function helperNeedsCopy(source: string, target: string): boolean {
    try {
        const sourceStat = statSync(source);
        const targetStat = statSync(target);
        return (
            sourceStat.size !== targetStat.size ||
            sourceStat.mtimeMs > targetStat.mtimeMs
        );
    } catch {
        return true;
    }
}

function prepareWindowsHelperAccess(directory: string): void {
    if (windowsHelperAccessPrepared || process.platform !== "win32") {
        return;
    }
    const computerName = process.env.COMPUTERNAME;
    const group = computerName
        ? `${computerName}\\sandbox-runtime-users`
        : "sandbox-runtime-users";
    try {
        execFileSync(
            "icacls.exe",
            [directory, "/grant", `${group}:(OI)(CI)(RX)`],
            {
                windowsHide: true,
                stdio: "ignore"
            }
        );
        windowsHelperAccessPrepared = true;
    } catch {
        // The sandbox group does not exist until the one-time install completes.
    }
}

function defaultWindowsSpawn(): SrtWinSpawn {
    return resolveSrtWin({
        path: sandboxWindowsExecutable()
    });
}

function unpackedPath(path: string): string {
    return path.replace(/([\\/])app\.asar([\\/])/, "$1app.asar.unpacked$2");
}

function appendTail(current: string, chunk: string): string {
    const value = current + chunk;
    return value.length > 8_192 ? value.slice(-8_192) : value;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
