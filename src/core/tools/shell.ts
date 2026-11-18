import { randomUUID } from "node:crypto";
import {
    spawn,
    type ChildProcessWithoutNullStreams,
    type StdioOptions
} from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { WindowsBinShell } from "@anthropic-ai/sandbox-runtime";
import { z } from "zod";
import type { LlmToolCallBlock, LlmToolDefinition } from "../../llm/types.ts";
import {
    createSandboxLaunch,
    preflightSandbox,
    type SandboxLaunch,
    type SandboxPreflight,
    type SandboxPreflightResult
} from "../permissions/sandbox-launch.ts";
import { isSandboxRunnerMessage } from "../permissions/sandbox-protocol.ts";
import type { SandboxPolicy } from "../permissions/sandbox.ts";
import {
    appendSandboxViolations,
    formatSandboxViolations
} from "../permissions/violations.ts";
import {
    MAX_TOOL_OUTPUT_CHARS,
    OUTPUT_TRUNCATION_NOTICE,
    formatTruncatedOutput
} from "./output.ts";
import type {
    ToolExecutionResult,
    ToolExecutionObserver,
    ToolExecutor,
    ToolStopEvent,
    ToolTaskSnapshot
} from "./types.ts";
import {
    EXEC_COMMAND_TOOL,
    WRITE_STDIN_TOOL,
    createToolCallViewData,
    type ShellExecCommandView,
    type ShellWriteStdinView
} from "./view.ts";

const DEFAULT_CWD = process.cwd();
const WINDOWS_POWERSHELL = findWindowsPowerShell();
const STOP_GRACE_MS = 2_000;
const STOP_FORCE_MS = 2_000;

const execCommandArguments = z.object({
    command: z.string().trim().min(1),
    cwd: z.string().trim().min(1),
    timeoutMs: z.number().int().positive()
});

const writeStdinArguments = z.object({
    sessionId: z.string().trim().min(1),
    command: z.string()
});

export const SHELL_TOOL_DEFINITIONS: readonly LlmToolDefinition[] = [{
    name: EXEC_COMMAND_TOOL,
    description: [
        `Run a command with ${shellDisplayName()} in an independent process and return its combined output.`,
        `Use syntax supported by ${shellDisplayName()}.`,
        "If the command is still running when timeoutMs elapses, keep it alive and return a sessionId.",
        "Use write_stdin to send more input to that session."
    ].join(" "),
    parameters: {
        type: "object",
        properties: {
            command: { type: "string", description: "Shell command to execute." },
            cwd: { type: "string", description: "Working directory for the command." },
            timeoutMs: { type: "integer", minimum: 1, description: "Maximum wait time in milliseconds." }
        },
        required: ["command", "cwd", "timeoutMs"],
        additionalProperties: false
    }
}, {
    name: WRITE_STDIN_TOOL,
    description: [
        "Return all output buffered since the previous tool result for this session.",
        "Then enqueue the provided command and write it to stdin when the session is still running.",
        "A newline is appended when the command does not already end with one.",
        "Pass an empty command to only retrieve buffered output."
    ].join(" "),
    parameters: {
        type: "object",
        properties: {
            sessionId: { type: "string", description: "Session id returned by exec_command." },
            command: { type: "string", description: "Text to write to stdin, or empty to poll." }
        },
        required: ["sessionId", "command"],
        additionalProperties: false
    }
}];

type ShellSession = {
    id: string;
    command: string;
    cwd: string;
    child: ChildProcessWithoutNullStreams;
    output: string;
    truncatedCharacters: number;
    truncationNoticeSent: boolean;
    /** Cursor for output already broadcast to the UI. */
    broadcastOffset: number;
    /** Cursor for output already returned to the model. */
    readOffset: number;
    commandQueue: string[];
    writing: boolean;
    ended: boolean;
    exitCode: number | null;
    error: string | null;
    sandbox: SandboxSessionState | null;
    done: Promise<void>;
    finish(): void;
    cleanup?: () => void;
    listener: ((chunk: string) => void) | null;
    exitListener: (() => void) | null;
};

type SandboxSessionState = {
    commandId: string;
    violations: string[];
    seenViolations: Set<string>;
    reportedViolations: number;
    done: boolean;
};

type ShellLaunch = {
    command: string;
    args: string[];
};

type WriteCommandState = "none" | "queued" | "rejected";

export type ShellSessionExit = {
    sessionId: string;
    exitCode: number | null;
    error: string | null;
    unreadOutput: string;
    truncatedCharacters: number;
    /** Whether this sandbox session has produced any violation. */
    intercepted: boolean;
    /** Violations not yet included in a previous tool result. */
    violations: readonly string[];
};

export type ShellToolOptions = {
    defaultCwd?: string | (() => string | undefined);
    sandboxPolicy?: () => SandboxPolicy | null;
    sandboxPreflight?: SandboxPreflight;
    sandboxRunnerPath?: string;
};

/** Executes shell commands in child processes and keeps timed-out sessions addressable. */
export class ShellTool implements ToolExecutor {
    readonly definitions = SHELL_TOOL_DEFINITIONS;
    private readonly defaultCwd?: string | (() => string | undefined);
    private readonly sandboxPolicy?: () => SandboxPolicy | null;
    private readonly sandboxPreflight: SandboxPreflight;
    private readonly sandboxRunnerPath?: string;
    private readonly addressableSessions = new Map<string, ShellSession>();
    private readonly children = new Set<ShellSession>();

    constructor(options: ShellToolOptions = {}) {
        this.defaultCwd = options.defaultCwd;
        this.sandboxPolicy = options.sandboxPolicy;
        this.sandboxPreflight = options.sandboxPreflight ?? preflightSandbox;
        this.sandboxRunnerPath = options.sandboxRunnerPath;
    }

    handles(name: string): boolean {
        return name === EXEC_COMMAND_TOOL || name === WRITE_STDIN_TOOL;
    }

    async execute(
        call: LlmToolCallBlock,
        observer: ToolExecutionObserver,
        signal?: AbortSignal
    ): Promise<ToolExecutionResult> {
        if (call.name === EXEC_COMMAND_TOOL) {
            return this.execCommand(call, observer, signal);
        }
        if (call.name === WRITE_STDIN_TOOL) {
            return this.writeStdin(call, observer, signal);
        }
        return {
            content: `Unknown shell tool: ${call.name}`,
            data: {
                ...createToolCallViewData(call.name, call.arguments, "failed"),
                output: `Unknown shell tool: ${call.name}`
            },
            isError: true,
            endReason: "exited"
        };
    }

    dispose(): void {
        for (const session of this.children) {
            session.listener = null;
            session.exitListener = null;
            if (!session.ended) {
                session.child.kill();
            }
        }
        this.children.clear();
        this.addressableSessions.clear();
    }

    async stop(): Promise<readonly ToolStopEvent[]> {
        await this.stopAll();
        return [];
    }

    async stopAll(): Promise<readonly ShellSessionExit[]> {
        const sessions = new Set([
            ...this.addressableSessions.values(),
            ...this.children
        ]);
        const exits = await Promise.all(
            [...sessions].map((session) => stopSession(session))
        );
        this.addressableSessions.clear();
        for (const session of sessions) {
            if (session.ended) {
                this.children.delete(session);
            }
        }
        return exits;
    }

    /** Release a completed session after its final buffered output was consumed. */
    releaseSession(sessionId: string): void {
        this.addressableSessions.delete(sessionId);
    }

    /**
     * Subscribe to future output from a task returned by exec_command or write_stdin.
     * Pending unread output is delivered immediately.
     */
    watchSession(
        sessionId: string,
        listener: (chunk: string, truncatedCharacters: number) => void,
        onExit?: (exit: ShellSessionExit) => void
    ): () => void {
        const session = this.addressableSessions.get(sessionId);
        if (!session) {
            return () => undefined;
        }

        const notifyExit = (): void => {
            if (!onExit) {
                return;
            }
            onExit({
                sessionId: session.id,
                exitCode: session.exitCode,
                error: session.error,
                unreadOutput: session.output.slice(session.readOffset),
                truncatedCharacters: session.truncatedCharacters,
                intercepted: (session.sandbox?.violations.length ?? 0) > 0,
                violations: takeViolations(session)
            });
        };
        const pending = session.output.slice(session.broadcastOffset);
        session.broadcastOffset = session.output.length;
        if (pending.length > 0) {
            listener(pending, session.truncatedCharacters);
        }
        if (session.ended) {
            notifyExit();
            return () => undefined;
        }

        const wrapped = (chunk: string): void => {
            session.broadcastOffset = session.output.length;
            listener(chunk, session.truncatedCharacters);
        };
        const exitListener = (): void => {
            if (session.exitListener === exitListener) {
                session.exitListener = null;
            }
            notifyExit();
        };
        session.listener = wrapped;
        session.exitListener = exitListener;
        return () => {
            if (session.listener === wrapped) {
                session.listener = null;
            }
            if (session.exitListener === exitListener) {
                session.exitListener = null;
            }
        };
    }

    private async execCommand(
        call: LlmToolCallBlock,
        observer: ToolExecutionObserver,
        signal?: AbortSignal
    ): Promise<ToolExecutionResult> {
        const parsed = execCommandArguments.safeParse(call.arguments);
        if (!parsed.success) {
            return invalidArgumentsResult(call, parsed.error.message);
        }

        const { command, timeoutMs } = parsed.data;
        if (this.sandboxPolicy?.()) {
            const preflight = await this.sandboxPreflight();
            if (!preflight.ready) {
                return sandboxPreflightResult(command, preflight);
            }
        }
        let session: ShellSession;
        try {
            session = this.start(command, this.resolveCwd(parsed.data.cwd), (chunk) => {
                session.broadcastOffset = session.output.length;
                observer.onOutput({ kind: "shell.exec_command", output: chunk });
            }, call.id);
        } catch (error) {
            const message = errorMessage(error);
            return {
                content: `Failed to start command: ${message}`,
                data: { kind: "shell.exec_command", command, output: message, status: "failed" },
                isError: true,
                endReason: "exited"
            };
        }

        const outcome = await waitForSession(session, timeoutMs, signal);
        if (outcome === "aborted") {
            await interruptSession(session);
            const violations = takeViolations(session);
            const output = appendSandboxViolations(sessionDisplayOutput(session), violations);
            return {
                content: appendViolationContent("Command aborted.", violations),
                data: { kind: "shell.exec_command", command, output, status: "failed" },
                isError: true,
                endReason: "exited"
            };
        }

        if (outcome === "timeout" && !session.ended) {
            session.listener = null;
            session.readOffset = session.output.length;
            const violations = takeViolations(session);
            this.addressableSessions.set(session.id, session);
            return {
                content: appendViolationContent(
                    timedOutContent(session.id, timeoutMs, sessionDisplayOutput(session)),
                    violations
                ),
                data: {
                    kind: "shell.exec_command",
                    command,
                    output: appendSandboxViolations(sessionDisplayOutput(session), violations),
                    status: violations.length > 0 ? "failed" : "timed_out"
                },
                isError: violations.length > 0,
                endReason: "background",
                task: taskSnapshot(session)
            };
        }

        session.listener = null;
        session.readOffset = session.output.length;
        return finishedResult(command, session);
    }

    private resolveCwd(cwd: string): string {
        const configured = typeof this.defaultCwd === "function"
            ? this.defaultCwd()
            : this.defaultCwd;
        return resolve(configured ?? DEFAULT_CWD, cwd);
    }

    private async writeStdin(
        call: LlmToolCallBlock,
        observer: ToolExecutionObserver,
        signal?: AbortSignal
    ): Promise<ToolExecutionResult> {
        const parsed = writeStdinArguments.safeParse(call.arguments);
        if (!parsed.success) {
            return invalidArgumentsResult(call, parsed.error.message);
        }

        const { sessionId, command } = parsed.data;
        const session = this.addressableSessions.get(sessionId);
        if (!session) {
            const message = `Shell session not found: ${sessionId}`;
            return {
                content: message,
                data: { kind: "shell.write_stdin", sessionId, command, output: message, status: "failed" },
                isError: true,
                endReason: "exited"
            };
        }

        if (signal?.aborted) {
            return {
                content: "Write aborted.",
                data: {
                    kind: "shell.write_stdin",
                    sessionId,
                    command,
                    output: "",
                    status: "failed"
                },
                isError: true,
                endReason: "exited"
            };
        }

        const pendingBroadcast = session.output.slice(session.broadcastOffset);
        if (pendingBroadcast.length > 0) {
            session.broadcastOffset = session.output.length;
            observer.onOutput({ kind: "shell.write_stdin", output: pendingBroadcast });
        }

        const buffered = session.output.slice(session.readOffset);
        session.readOffset = session.output.length;
        const violations = takeViolations(session);
        let commandState: WriteCommandState = "none";
        if (command.length > 0) {
            if (!session.ended && session.child.stdin.writable) {
                enqueueCommand(session, command);
                commandState = "queued";
            } else {
                commandState = "rejected";
            }
        }

        const processStatus = sessionStatus(session);
        const status = violations.length > 0 ? "failed" : processStatus;
        const output = buffered.length > 0
            ? formatTruncatedOutput(buffered, session.truncatedCharacters)
            : "";
        const data: ShellWriteStdinView = {
            kind: "shell.write_stdin",
            sessionId,
            command,
            output: appendSandboxViolations(output, violations),
            status
        };
        return {
            content: appendViolationContent(
                writeResultContent(sessionId, processStatus, session.exitCode, session.error, output, commandState),
                violations
            ),
            data,
            isError: status === "failed",
            endReason: processStatus === "running" ? "background" : "exited",
            task: taskSnapshot(session)
        };
    }

    private start(
        command: string,
        cwd: string,
        listener: (chunk: string) => void,
        toolCallId: string
    ): ShellSession {
        const sandboxed = this.sandboxLaunch(command, cwd, toolCallId);
        const launch = sandboxed?.launch ?? shellLaunch(command);
        let child: ChildProcessWithoutNullStreams;
        try {
            const stdio: StdioOptions = sandboxed
                ? ["pipe", "pipe", "pipe", "ipc"]
                : ["pipe", "pipe", "pipe"];
            child = spawn(launch.command, launch.args, {
                cwd,
                env: sandboxed?.env ?? process.env,
                stdio,
                windowsHide: true,
                detached: process.platform !== "win32"
            }) as ChildProcessWithoutNullStreams;
        } catch (error) {
            sandboxed?.cleanup();
            throw error;
        }
        let resolveDone!: () => void;
        const done = new Promise<void>((resolvePromise) => {
            resolveDone = resolvePromise;
        });
        const session: ShellSession = {
            id: randomUUID(),
            command,
            cwd,
            child,
            output: "",
            truncatedCharacters: 0,
            truncationNoticeSent: false,
            broadcastOffset: 0,
            readOffset: 0,
            commandQueue: [],
            writing: false,
            ended: false,
            exitCode: null,
            error: null,
            sandbox: sandboxed
                ? {
                    commandId: sandboxed.commandId,
                    violations: [],
                    seenViolations: new Set(),
                    reportedViolations: 0,
                    done: false
                }
                : null,
            done,
            finish: () => {
                if (session.ended) {
                    return;
                }
                session.ended = true;
                session.listener = null;
                session.commandQueue.length = 0;
                session.writing = false;
                const exitListener = session.exitListener;
                session.exitListener = null;
                session.cleanup?.();
                session.cleanup = undefined;
                this.children.delete(session);
                resolveDone();
                exitListener?.();
            },
            cleanup: sandboxed?.cleanup,
            listener,
            exitListener: null
        };
        this.children.add(session);

        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => appendOutput(session, chunk));
        child.stderr.on("data", (chunk: string) => appendOutput(session, chunk));
        let closeReceived = false;
        let completionTimer: NodeJS.Timeout | undefined;
        const finishWhenReady = (): void => {
            if (!closeReceived || (session.sandbox !== null && !session.sandbox.done)) {
                return;
            }
            if (completionTimer !== undefined) {
                clearTimeout(completionTimer);
                completionTimer = undefined;
            }
            session.finish();
        };
        child.on("message", (message: unknown) => {
            const sandbox = session.sandbox;
            if (
                !sandboxed ||
                !sandbox ||
                !isSandboxRunnerMessage(message) ||
                message.commandId !== sandboxed.commandId
            ) {
                return;
            }
            if (message.type === "violations") {
                addSandboxViolations(sandbox, message.violations);
                return;
            }
            sandbox.done = true;
            session.exitCode = message.exitCode;
            finishWhenReady();
        });
        child.once("error", (error) => {
            session.error = error.message;
            if (completionTimer !== undefined) {
                clearTimeout(completionTimer);
            }
            session.finish();
        });
        child.once("close", (code) => {
            closeReceived = true;
            session.exitCode = code;
            if (session.sandbox !== null) {
                completionTimer = setTimeout(() => {
                    completionTimer = undefined;
                    if (session.sandbox !== null) {
                        session.sandbox.done = true;
                    }
                    finishWhenReady();
                }, 75);
            }
            finishWhenReady();
        });
        child.stdin.on("error", (error) => {
            session.error = error.message;
            if (completionTimer !== undefined) {
                clearTimeout(completionTimer);
            }
            session.finish();
        });
        return session;
    }

    private sandboxLaunch(
        command: string,
        cwd: string,
        toolCallId: string
    ): SandboxLaunch | null {
        const policy = this.sandboxPolicy?.();
        if (!policy) {
            return null;
        }

        return createSandboxLaunch({
            command,
            cwd,
            commandId: toolCallId,
            policy,
            binShell: sandboxBinShell(),
            runnerPath: this.sandboxRunnerPath
        });
    }
}

function sandboxBinShell(): string | WindowsBinShell | undefined {
    if (process.platform === "win32") {
        return WINDOWS_POWERSHELL
            ? {
                exe: WINDOWS_POWERSHELL,
                args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"]
            }
            : "cmd";
    }
    return process.env.SHELL || undefined;
}

function appendOutput(session: ShellSession, chunk: string): void {
    session.output += chunk;
    const overflow = session.output.length - MAX_TOOL_OUTPUT_CHARS;
    if (overflow > 0) {
        session.output = session.output.slice(overflow);
        session.truncatedCharacters += overflow;
        session.broadcastOffset = Math.max(0, session.broadcastOffset - overflow);
        session.readOffset = Math.max(0, session.readOffset - overflow);
    }
    if (session.truncatedCharacters > 0 && !session.truncationNoticeSent) {
        session.listener?.(OUTPUT_TRUNCATION_NOTICE);
        session.truncationNoticeSent = session.listener !== null;
    }
    session.listener?.(chunk);
}

function addSandboxViolations(
    sandbox: SandboxSessionState,
    violations: readonly { line: string }[]
): void {
    for (const violation of violations) {
        const line = violation.line.trim();
        if (line.length === 0 || sandbox.seenViolations.has(line)) {
            continue;
        }
        sandbox.seenViolations.add(line);
        sandbox.violations.push(line);
    }
}

function takeViolations(session: ShellSession): string[] {
    const sandbox = session.sandbox;
    if (!sandbox) {
        return [];
    }
    const violations = sandbox.violations.slice(sandbox.reportedViolations);
    sandbox.reportedViolations = sandbox.violations.length;
    return violations;
}

function appendViolationContent(content: string, violations: readonly string[]): string {
    const block = formatSandboxViolations(violations);
    return block.length > 0 ? `${content}\n\n${block}` : content;
}

function enqueueCommand(session: ShellSession, command: string): void {
    session.commandQueue.push(command.endsWith("\n") ? command : `${command}\n`);
    flushCommandQueue(session);
}

function flushCommandQueue(session: ShellSession): void {
    if (session.ended || session.writing || !session.child.stdin.writable) {
        return;
    }

    while (session.commandQueue.length > 0) {
        const command = session.commandQueue.shift()!;
        try {
            const accepted = session.child.stdin.write(command);
            if (!accepted) {
                session.writing = true;
                session.child.stdin.once("drain", () => {
                    session.writing = false;
                    flushCommandQueue(session);
                });
                return;
            }
        } catch (error) {
            session.error = errorMessage(error);
            session.finish();
            return;
        }
    }
}

function waitForSession(
    session: ShellSession,
    timeoutMs: number,
    signal?: AbortSignal
): Promise<"exited" | "timeout" | "aborted"> {
    if (session.ended) {
        return Promise.resolve("exited");
    }
    if (signal?.aborted) {
        return Promise.resolve("aborted");
    }

    return new Promise((resolvePromise) => {
        let settled = false;
        const finish = (result: "exited" | "timeout" | "aborted"): void => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener("abort", abort);
            resolvePromise(result);
        };
        const abort = (): void => finish("aborted");
        const timer = setTimeout(() => finish("timeout"), timeoutMs);
        signal?.addEventListener("abort", abort, { once: true });
        void session.done.then(() => finish("exited"));
    });
}

async function interruptSession(session: ShellSession): Promise<void> {
    session.listener = null;
    if (!session.ended) {
        await terminateProcessTree(session);
        await Promise.race([
            session.done,
            new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 100))
        ]);
    }
    session.listener = null;
}

async function stopSession(session: ShellSession): Promise<ShellSessionExit> {
    session.listener = null;
    if (!session.ended) {
        await terminateProcessTree(session);
        if (!await waitForDone(session, STOP_GRACE_MS)) {
            await forceTerminateProcessTree(session);
            if (!await waitForDone(session, STOP_FORCE_MS)) {
                session.error ??= "The process did not exit after termination.";
            }
        }
    }
    return {
        sessionId: session.id,
        exitCode: session.exitCode,
        error: session.error,
        unreadOutput: session.output.slice(session.readOffset),
        truncatedCharacters: session.truncatedCharacters,
        intercepted: (session.sandbox?.violations.length ?? 0) > 0,
        violations: takeViolations(session)
    };
}

function waitForDone(session: ShellSession, timeoutMs: number): Promise<boolean> {
    if (session.ended) {
        return Promise.resolve(true);
    }
    return new Promise((resolvePromise) => {
        let settled = false;
        const finish = (ended: boolean): void => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            resolvePromise(ended);
        };
        const timer = setTimeout(() => finish(false), timeoutMs);
        void session.done.then(() => finish(true));
    });
}

async function terminateProcessTree(session: ShellSession): Promise<void> {
    const pid = session.child.pid;
    if (pid === undefined) {
        session.child.kill();
        return;
    }

    if (process.platform === "win32") {
        await taskkill(pid, session);
        return;
    }

    try {
        process.kill(-pid, "SIGTERM");
    } catch {
        session.child.kill();
    }
}

async function forceTerminateProcessTree(session: ShellSession): Promise<void> {
    const pid = session.child.pid;
    if (pid === undefined) {
        session.child.kill("SIGKILL");
        return;
    }

    if (process.platform === "win32") {
        await taskkill(pid, session);
        return;
    }

    try {
        process.kill(-pid, "SIGKILL");
    } catch {
        session.child.kill("SIGKILL");
    }
}

async function taskkill(pid: number, session: ShellSession): Promise<void> {
    const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows";
    await new Promise<void>((resolvePromise) => {
        const killer = spawn(
            join(systemRoot, "System32", "taskkill.exe"),
            ["/PID", String(pid), "/T", "/F"],
            { stdio: "ignore", windowsHide: true }
        );
        killer.once("error", () => {
            session.child.kill();
            resolvePromise();
        });
        killer.once("close", () => resolvePromise());
    });
}

function finishedResult(command: string, session: ShellSession): ToolExecutionResult {
    const violations = takeViolations(session);
    const status = violations.length > 0 ? "failed" : sessionStatus(session);
    const renderedOutput = sessionDisplayOutput(session);
    const output = appendSandboxViolations(renderedOutput, violations);
    const details: ShellExecCommandView = {
        kind: "shell.exec_command",
        command,
        output,
        status
    };
    return {
        content: appendViolationContent(
            finishedContent(session.exitCode, session.error, renderedOutput),
            violations
        ),
        data: details,
        isError: status === "failed",
        endReason: "exited"
    };
}

function invalidArgumentsResult(call: LlmToolCallBlock, message: string): ToolExecutionResult {
    const data = createToolCallViewData(call.name, call.arguments, "failed");
    return {
        content: `Invalid arguments for ${call.name}: ${message}`,
        data: { ...data, output: message },
        isError: true,
        endReason: "exited"
    };
}

function sandboxPreflightResult(
    command: string,
    preflight: Extract<SandboxPreflightResult, { ready: false }>
): ToolExecutionResult {
    const message = [
        "The command was not executed because the local sandbox is not ready.",
        ...preflight.errors,
        "Install or repair the Windows sandbox from Jarvix, then retry.",
        "This is a host setup problem, not a permission-mode denial."
    ].join("\n\n");
    return {
        content: message,
        data: {
            kind: "shell.exec_command",
            command,
            output: message,
            status: "failed"
        },
        isError: true,
        endReason: "exited"
    };
}

function taskSnapshot(session: ShellSession): ToolTaskSnapshot {
    return {
        id: session.id,
        kind: "shell",
        command: session.command,
        cwd: session.cwd,
        output: session.output,
        status: sessionStatus(session),
        exitCode: session.exitCode,
        error: session.error,
        unreadCharacters: session.output.length - session.readOffset,
        truncatedCharacters: session.truncatedCharacters
    };
}

function sessionDisplayOutput(session: ShellSession): string {
    return formatTruncatedOutput(session.output, session.truncatedCharacters);
}

function sessionStatus(session: ShellSession): "running" | "completed" | "failed" {
    if (session.error) {
        return "failed";
    }
    if (!session.ended) {
        return "running";
    }
    return session.exitCode === 0 ? "completed" : "failed";
}

function timedOutContent(sessionId: string, timeoutMs: number, output: string): string {
    return [
        `Command is still running after ${timeoutMs} ms.`,
        `sessionId: ${sessionId}`,
        "Use write_stdin with this sessionId to send input or poll for more output.",
        "Output so far:",
        output,
        "",
        `IMPORTANT: The command has NOT finished. Continue with write_stdin and sessionId ${sessionId}.`
    ].join("\n");
}

function finishedContent(exitCode: number | null, error: string | null, output: string): string {
    const header = error ? `Command failed: ${error}` : `Command exited with code ${exitCode ?? "unknown"}.`;
    return `${header}\nOutput:\n${output}`;
}

function writeResultContent(
    sessionId: string,
    status: "running" | "completed" | "failed",
    exitCode: number | null,
    error: string | null,
    output: string,
    commandState: WriteCommandState
): string {
    const state = status === "running"
        ? `Shell is still running. sessionId: ${sessionId}`
        : status === "completed"
            ? `Shell exited with code ${exitCode ?? 0}.`
            : `Shell failed${error ? `: ${error}` : exitCode === null ? "." : ` with code ${exitCode}.`}`;
    const command = commandState === "none"
        ? "No stdin command was queued."
        : commandState === "queued"
            ? "The stdin command was queued."
            : "The stdin command was not executed because the shell has already exited.";
    const buffer = output.length > 0
        ? `Buffered output returned:\n${output}`
        : "No buffered output was available.";
    const ending = status === "running"
        ? "The task has not ended. New output will be buffered and broadcast; use write_stdin again to retrieve it."
        : "The buffered output has been drained.";
    return [state, command, buffer, ending].join("\n");
}

function shellLaunch(command: string): ShellLaunch {
    if (process.platform === "win32") {
        if (WINDOWS_POWERSHELL) {
            return {
                command: WINDOWS_POWERSHELL,
                args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command]
            };
        }
        const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows";
        return {
            command: process.env.ComSpec ?? join(systemRoot, "System32", "cmd.exe"),
            args: ["/d", "/s", "/c", command]
        };
    }
    return {
        command: process.env.SHELL || "/bin/sh",
        args: ["-lc", command]
    };
}

function findWindowsPowerShell(): string | undefined {
    if (process.platform !== "win32") {
        return undefined;
    }
    const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows";
    const programFiles = process.env.ProgramFiles;
    const candidates = [
        join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
        programFiles ? join(programFiles, "PowerShell", "7", "pwsh.exe") : undefined
    ];
    return candidates.find((candidate): candidate is string => candidate !== undefined && existsSync(candidate));
}

function shellDisplayName(): string {
    if (process.platform === "win32") {
        return WINDOWS_POWERSHELL ? "Windows PowerShell" : "cmd.exe";
    }
    return process.env.SHELL || "/bin/sh";
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
