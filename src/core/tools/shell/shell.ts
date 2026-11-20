import { randomUUID } from "node:crypto";
import {
    spawn,
    type ChildProcessWithoutNullStreams,
    type StdioOptions
} from "node:child_process";
import { resolve } from "node:path";
import { z } from "zod";
import type { LlmToolCallBlock, LlmToolDefinition } from "../../../llm/types.ts";
import {
    createSandboxLaunch,
    preflightSandbox,
    type SandboxLaunch,
    type SandboxPreflight
} from "../../permissions/sandbox-launch.ts";
import { isSandboxRunnerMessage } from "../../permissions/sandbox-protocol.ts";
import type { SandboxPolicy } from "../../permissions/sandbox.ts";
import { appendSandboxViolations } from "../../permissions/violations.ts";
import { formatTruncatedOutput } from "../shared/output.ts";
import type {
    ToolExecutionResult,
    ToolExecutionObserver,
    ToolExecutor,
    ToolStopEvent
} from "../shared/types.ts";
import { createGenericToolCallViewData } from "../shared/view.ts";
import {
    sandboxBinShell,
    shellDisplayName,
    shellLaunch
} from "./launch.ts";
import {
    DEFAULT_MAX_APP_SHELL_SESSIONS,
    DEFAULT_MAX_SHELL_SESSIONS,
    MAX_STDIN_COMMAND_CHARS,
    MAX_STDIN_QUEUE_CHARS,
    MAX_STDIN_QUEUE_COMMANDS
} from "./limits.ts";
import {
    STOP_GRACE_MS,
    terminateProcessTreeSync
} from "./process-tree.ts";
import {
    finishedResult,
    invalidArgumentsResult,
    sandboxPreflightResult,
    sessionLimitResult,
    sharedSessionLimitResult,
    timedOutContent,
    writeResultContent
} from "./results.ts";
import {
    addSandboxViolations,
    appendOutput,
    appendViolationContent,
    enqueueCommand,
    interruptSession,
    sessionDisplayOutput,
    sessionStatus,
    stopSession,
    takeViolations,
    taskSnapshot,
    waitForSession,
    type ShellSession,
    type ShellSessionExit,
    type WriteCommandState
} from "./session.ts";
import {
    EXEC_COMMAND_TOOL,
    WRITE_STDIN_TOOL,
    createShellToolCallViewData,
    type ShellWriteStdinView
} from "./view.ts";

export type { ShellSessionExit } from "./session.ts";
export {
    DEFAULT_MAX_APP_SHELL_SESSIONS,
    DEFAULT_MAX_SHELL_SESSIONS,
    MAX_STDIN_COMMAND_CHARS,
    MAX_STDIN_QUEUE_CHARS,
    MAX_STDIN_QUEUE_COMMANDS
};

const DEFAULT_CWD = process.cwd();
const MAX_TIMEOUT_MS = 2_147_483_647;

/** Shares a bounded number of active or retained shell sessions across conversations. */
export class ShellSessionBudget {
    readonly capacity: number;
    private readonly reclaimable = new Map<string, () => void>();
    private used = 0;

    constructor(capacity = DEFAULT_MAX_APP_SHELL_SESSIONS) {
        if (!Number.isSafeInteger(capacity) || capacity < 1) {
            throw new RangeError("capacity must be a positive safe integer.");
        }
        this.capacity = capacity;
    }

    get inUse(): number {
        return this.used;
    }

    tryAcquire(): boolean {
        while (this.used >= this.capacity) {
            const oldest = this.reclaimable.entries().next().value;
            if (!oldest) {
                return false;
            }
            this.reclaimable.delete(oldest[0]);
            oldest[1]();
        }
        this.used += 1;
        return true;
    }

    release(): void {
        if (this.used > 0) {
            this.used -= 1;
        }
    }

    /** Register a completed unread session that may free its slot under pressure. */
    registerReclaimable(sessionId: string, reclaim: () => void): void {
        this.reclaimable.set(sessionId, reclaim);
    }

    unregisterReclaimable(sessionId: string): void {
        this.reclaimable.delete(sessionId);
    }
}

const execCommandArguments = z.object({
    command: z.string().trim().min(1),
    cwd: z.string().trim().min(1),
    timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS)
});

const writeStdinArguments = z.object({
    sessionId: z.string().trim().min(1),
    command: z.string().max(MAX_STDIN_COMMAND_CHARS)
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
            timeoutMs: {
                type: "integer",
                minimum: 1,
                maximum: MAX_TIMEOUT_MS,
                description: "Maximum wait time in milliseconds."
            }
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
            command: {
                type: "string",
                maxLength: MAX_STDIN_COMMAND_CHARS,
                description: "Text to write to stdin, or empty to poll."
            }
        },
        required: ["sessionId", "command"],
        additionalProperties: false
    }
}];

export type ShellToolOptions = {
    defaultCwd?: string | (() => string | undefined);
    sandboxPolicy?: () => SandboxPolicy | null;
    sandboxPreflight?: SandboxPreflight;
    sandboxRunnerPath?: string;
    maxSessions?: number;
    sharedBudget?: ShellSessionBudget;
};

/** Executes shell commands in child processes and keeps timed-out sessions addressable. */
export class ShellTool implements ToolExecutor {
    readonly definitions = SHELL_TOOL_DEFINITIONS;
    private readonly defaultCwd?: string | (() => string | undefined);
    private readonly sandboxPolicy?: () => SandboxPolicy | null;
    private readonly sandboxPreflight: SandboxPreflight;
    private readonly sandboxRunnerPath?: string;
    private readonly maxSessions: number;
    readonly sharedBudget?: ShellSessionBudget;
    private readonly addressableSessions = new Map<string, ShellSession>();
    private readonly children = new Set<ShellSession>();

    constructor(options: ShellToolOptions = {}) {
        this.defaultCwd = options.defaultCwd;
        this.sandboxPolicy = options.sandboxPolicy;
        this.sandboxPreflight = options.sandboxPreflight ?? preflightSandbox;
        this.sandboxRunnerPath = options.sandboxRunnerPath;
        this.maxSessions = normalizeSessionLimit(options.maxSessions);
        this.sharedBudget = options.sharedBudget;
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
                ...createGenericToolCallViewData(call.name, call.arguments, "failed"),
                output: `Unknown shell tool: ${call.name}`
            },
            isError: true,
            endReason: "exited"
        };
    }

    dispose(): void {
        const sessions = new Set([
            ...this.children,
            ...this.addressableSessions.values()
        ]);
        const terminationDeadline = Date.now() + STOP_GRACE_MS;
        for (const session of sessions) {
            session.listener = null;
            session.exitListener = null;
            if (!session.ended) {
                terminateProcessTreeSync(session, terminationDeadline);
            }
        }
        for (const session of sessions) {
            session.retained = false;
            this.releaseSharedSlot(session);
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
            session.retained = false;
            if (session.ended) {
                this.children.delete(session);
                this.releaseSharedSlot(session);
            }
        }
        return exits;
    }

    /** Release a completed session after its final buffered output was consumed. */
    releaseSession(sessionId: string): void {
        const session = this.addressableSessions.get(sessionId);
        if (!session) {
            return;
        }
        this.addressableSessions.delete(sessionId);
        session.retained = false;
        if (session.ended) {
            this.releaseSharedSlot(session);
        }
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
                intercepted: session.sandbox?.intercepted ?? false,
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
        if (this.sessionCount() >= this.maxSessions) {
            return sessionLimitResult(command, this.maxSessions);
        }
        if (this.sandboxPolicy?.()) {
            const preflight = await this.sandboxPreflight();
            if (!preflight.ready) {
                return sandboxPreflightResult(command, preflight);
            }
        }
        if (this.sessionCount() >= this.maxSessions) {
            return sessionLimitResult(command, this.maxSessions);
        }
        if (this.sharedBudget && !this.sharedBudget.tryAcquire()) {
            return sharedSessionLimitResult(command, this.sharedBudget.capacity);
        }
        let session: ShellSession;
        try {
            session = this.start(command, this.resolveCwd(parsed.data.cwd), (chunk) => {
                session.broadcastOffset = session.output.length;
                observer.onOutput({ kind: "shell.exec_command", output: chunk });
            }, call.id, this.sharedBudget !== undefined);
        } catch (error) {
            this.sharedBudget?.release();
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
            session.retained = true;
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

    private sessionCount(): number {
        let count = this.children.size;
        for (const session of this.addressableSessions.values()) {
            if (!this.children.has(session)) {
                count += 1;
            }
        }
        return count;
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
                commandState = enqueueCommand(session, command) ? "queued" : "overflowed";
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
            isError: status === "failed" || commandState === "overflowed",
            endReason: processStatus === "running" ? "background" : "exited",
            task: taskSnapshot(session)
        };
    }

    private start(
        command: string,
        cwd: string,
        listener: (chunk: string) => void,
        toolCallId: string,
        sharedSlotHeld: boolean
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
            commandQueueChars: 0,
            writing: false,
            retained: false,
            sharedSlotHeld,
            ended: false,
            exitCode: null,
            error: null,
            sandbox: sandboxed
                ? {
                    commandId: sandboxed.commandId,
                    violations: [],
                    seenViolations: new Set(),
                    omittedViolations: 0,
                    intercepted: false,
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
                session.commandQueueChars = 0;
                session.writing = false;
                const exitListener = session.exitListener;
                session.exitListener = null;
                session.cleanup?.();
                session.cleanup = undefined;
                this.children.delete(session);
                if (!session.retained) {
                    this.releaseSharedSlot(session);
                }
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

    private releaseSharedSlot(session: ShellSession): void {
        this.sharedBudget?.unregisterReclaimable(session.id);
        if (!session.sharedSlotHeld) {
            return;
        }
        session.sharedSlotHeld = false;
        this.sharedBudget?.release();
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function normalizeSessionLimit(limit: number | undefined): number {
    if (limit === undefined) {
        return DEFAULT_MAX_SHELL_SESSIONS;
    }
    if (!Number.isSafeInteger(limit) || limit < 1) {
        throw new RangeError("maxSessions must be a positive safe integer.");
    }
    return limit;
}
