import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { LlmToolCallBlock, LlmToolDefinition } from "../llm/types.ts";
import type { ToolExecutionResult, ToolExecutor, ToolOutputHandler } from "./types.ts";
import {
    EXEC_COMMAND_TOOL,
    WRITE_STDIN_TOOL,
    createToolCallViewData,
    type ShellExecCommandView,
    type ShellWriteStdinView
} from "./view.ts";

const DEFAULT_CWD = process.cwd();
const WINDOWS_POWERSHELL = findWindowsPowerShell();

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
    child: ChildProcessWithoutNullStreams;
    output: string;
    /** Cursor for output already broadcast to the UI. */
    broadcastOffset: number;
    /** Cursor for output already returned to the model. */
    readOffset: number;
    commandQueue: string[];
    writing: boolean;
    ended: boolean;
    exitCode: number | null;
    error: string | null;
    done: Promise<void>;
    finish(): void;
    listener: ((chunk: string) => void) | null;
    exitListener: (() => void) | null;
};

type ShellLaunch = {
    command: string;
    args: string[];
};

type WriteCommandState = "none" | "queued" | "rejected";

export type ShellSessionExit = {
    exitCode: number | null;
    error: string | null;
    unreadOutput: string;
};

export type ShellToolOptions = {
    defaultCwd?: string;
};

/** Executes shell commands in child processes and keeps timed-out sessions addressable. */
export class ShellTool implements ToolExecutor {
    readonly definitions = SHELL_TOOL_DEFINITIONS;
    private readonly defaultCwd: string;
    private readonly sessions = new Map<string, ShellSession>();
    private readonly children = new Set<ShellSession>();

    constructor(options: ShellToolOptions = {}) {
        this.defaultCwd = resolve(options.defaultCwd ?? DEFAULT_CWD);
    }

    handles(name: string): boolean {
        return name === EXEC_COMMAND_TOOL || name === WRITE_STDIN_TOOL;
    }

    async execute(
        call: LlmToolCallBlock,
        onOutput: ToolOutputHandler,
        signal?: AbortSignal
    ): Promise<ToolExecutionResult> {
        if (call.name === EXEC_COMMAND_TOOL) {
            return this.execCommand(call, onOutput, signal);
        }
        if (call.name === WRITE_STDIN_TOOL) {
            return this.writeStdin(call, onOutput, signal);
        }
        return {
            content: `Unknown shell tool: ${call.name}`,
            data: {
                ...createToolCallViewData(call.name, call.arguments, "failed"),
                output: `Unknown shell tool: ${call.name}`
            },
            isError: true
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
        this.sessions.clear();
    }

    /**
     * Subscribe to future output from a task returned by exec_command or write_stdin.
     * Pending unread output is delivered immediately.
     */
    watchSession(
        sessionId: string,
        listener: (chunk: string) => void,
        onExit?: (exit: ShellSessionExit) => void
    ): () => void {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return () => undefined;
        }

        const notifyExit = (): void => {
            onExit?.({
                exitCode: session.exitCode,
                error: session.error,
                unreadOutput: session.output.slice(session.readOffset)
            });
        };
        const pending = session.output.slice(session.broadcastOffset);
        session.broadcastOffset = session.output.length;
        if (pending.length > 0) {
            listener(pending);
        }
        if (session.ended) {
            notifyExit();
            return () => undefined;
        }

        const wrapped = (chunk: string): void => {
            session.broadcastOffset = session.output.length;
            listener(chunk);
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
        onOutput: ToolOutputHandler,
        signal?: AbortSignal
    ): Promise<ToolExecutionResult> {
        const parsed = execCommandArguments.safeParse(call.arguments);
        if (!parsed.success) {
            return invalidArgumentsResult(call, parsed.error.message);
        }

        const { command, timeoutMs } = parsed.data;
        let session: ShellSession;
        try {
            session = this.start(command, resolve(this.defaultCwd, parsed.data.cwd), (chunk) => {
                session.broadcastOffset = session.output.length;
                onOutput({ kind: "shell.exec_command", output: chunk });
            });
        } catch (error) {
            const message = errorMessage(error);
            return {
                content: `Failed to start command: ${message}`,
                data: { kind: "shell.exec_command", command, output: message, status: "failed" },
                isError: true
            };
        }

        const outcome = await waitForSession(session, timeoutMs, signal);
        if (outcome === "aborted") {
            session.listener = null;
            session.child.kill();
            return {
                content: "Command aborted.",
                data: { kind: "shell.exec_command", command, output: session.output, status: "failed" },
                isError: true
            };
        }

        if (outcome === "timeout" && !session.ended) {
            session.readOffset = session.output.length;
            this.sessions.set(session.id, session);
            return {
                content: timedOutContent(session.id, timeoutMs, session.output),
                data: { kind: "shell.exec_command", command, output: session.output, status: "timed_out" },
                isError: false,
                taskId: session.id
            };
        }

        session.listener = null;
        session.readOffset = session.output.length;
        return finishedResult(command, session);
    }

    private async writeStdin(
        call: LlmToolCallBlock,
        onOutput: ToolOutputHandler,
        signal?: AbortSignal
    ): Promise<ToolExecutionResult> {
        const parsed = writeStdinArguments.safeParse(call.arguments);
        if (!parsed.success) {
            return invalidArgumentsResult(call, parsed.error.message);
        }

        const { sessionId, command } = parsed.data;
        const session = this.sessions.get(sessionId);
        if (!session) {
            const message = `Shell session not found: ${sessionId}`;
            return {
                content: message,
                data: { kind: "shell.write_stdin", sessionId, command, output: message, status: "failed" },
                isError: true
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
                isError: true
            };
        }

        const pendingBroadcast = session.output.slice(session.broadcastOffset);
        if (pendingBroadcast.length > 0) {
            session.broadcastOffset = session.output.length;
            onOutput({ kind: "shell.write_stdin", output: pendingBroadcast });
        }

        const buffered = session.output.slice(session.readOffset);
        session.readOffset = session.output.length;
        let commandState: WriteCommandState = "none";
        if (command.length > 0) {
            if (!session.ended && session.child.stdin.writable) {
                enqueueCommand(session, command);
                commandState = "queued";
            } else {
                commandState = "rejected";
            }
        }

        const status = sessionStatus(session);
        const data: ShellWriteStdinView = {
            kind: "shell.write_stdin",
            sessionId,
            command,
            output: buffered,
            status
        };
        return {
            content: writeResultContent(sessionId, status, session.exitCode, session.error, buffered, commandState),
            data,
            isError: status === "failed",
            taskId: !session.ended ? sessionId : undefined
        };
    }

    private start(command: string, cwd: string, listener: (chunk: string) => void): ShellSession {
        const launch = shellLaunch(command);
        const child = spawn(launch.command, launch.args, {
            cwd,
            env: process.env,
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true
        });
        let resolveDone!: () => void;
        const done = new Promise<void>((resolvePromise) => {
            resolveDone = resolvePromise;
        });
        const session: ShellSession = {
            id: randomUUID(),
            child,
            output: "",
            broadcastOffset: 0,
            readOffset: 0,
            commandQueue: [],
            writing: false,
            ended: false,
            exitCode: null,
            error: null,
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
                this.children.delete(session);
                resolveDone();
                exitListener?.();
            },
            listener,
            exitListener: null
        };
        this.children.add(session);

        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => appendOutput(session, chunk));
        child.stderr.on("data", (chunk: string) => appendOutput(session, chunk));
        child.once("error", (error) => {
            session.error = error.message;
            session.finish();
        });
        child.once("close", (code) => {
            session.exitCode = code;
            session.finish();
        });
        child.stdin.on("error", (error) => {
            session.error = error.message;
            session.finish();
        });
        return session;
    }
}

function appendOutput(session: ShellSession, chunk: string): void {
    session.output += chunk;
    session.listener?.(chunk);
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

function finishedResult(command: string, session: ShellSession): ToolExecutionResult {
    const status = sessionStatus(session);
    const output = session.output;
    const details: ShellExecCommandView = {
        kind: "shell.exec_command",
        command,
        output,
        status
    };
    return {
        content: finishedContent(session.exitCode, session.error, output),
        data: details,
        isError: status === "failed"
    };
}

function invalidArgumentsResult(call: LlmToolCallBlock, message: string): ToolExecutionResult {
    const data = createToolCallViewData(call.name, call.arguments, "failed");
    return {
        content: `Invalid arguments for ${call.name}: ${message}`,
        data: { ...data, output: message },
        isError: true
    };
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
