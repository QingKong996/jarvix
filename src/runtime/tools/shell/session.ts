import type { ChildProcessWithoutNullStreams } from "node:child_process";
import {
    formatSandboxViolations,
    rememberSandboxViolation
} from "../../../core/permissions/violations.ts";
import {
    MAX_TOOL_OUTPUT_CHARS,
    OUTPUT_TRUNCATION_NOTICE,
    formatTruncatedOutput
} from "../output.ts";
import type { ToolTaskSnapshot } from "../types.ts";
import {
    MAX_STDIN_QUEUE_CHARS,
    MAX_STDIN_QUEUE_COMMANDS
} from "./limits.ts";
import {
    STOP_FORCE_MS,
    STOP_GRACE_MS,
    forceTerminateProcessTree,
    terminateProcessTree
} from "./process-tree.ts";

const MAX_PENDING_SANDBOX_VIOLATIONS = 100;

export type ShellSession = {
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
    commandQueueChars: number;
    writing: boolean;
    /** Whether this session can be addressed after its foreground wait ends. */
    retained: boolean;
    /** Whether this session currently owns a shared application-wide slot. */
    sharedSlotHeld: boolean;
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
    omittedViolations: number;
    intercepted: boolean;
};

export type WriteCommandState = "none" | "queued" | "rejected" | "overflowed";

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

export function appendOutput(session: ShellSession, chunk: string): void {
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

export function addSandboxViolations(
    sandbox: SandboxSessionState,
    violations: readonly { line: string }[]
): void {
    for (const violation of violations) {
        const line = violation.line.trim();
        if (line.length === 0 || !rememberSandboxViolation(sandbox.seenViolations, line)) {
            continue;
        }
        sandbox.intercepted = true;
        sandbox.violations.push(line);
        if (sandbox.violations.length > MAX_PENDING_SANDBOX_VIOLATIONS) {
            sandbox.violations.shift();
            sandbox.omittedViolations += 1;
        }
    }
}

export function takeViolations(session: ShellSession): string[] {
    const sandbox = session.sandbox;
    if (!sandbox) {
        return [];
    }
    const violations = sandbox.violations.splice(0);
    if (sandbox.omittedViolations > 0) {
        violations.unshift(
            `[${sandbox.omittedViolations} earlier sandbox violations omitted]`
        );
        sandbox.omittedViolations = 0;
    }
    return violations;
}

export function appendViolationContent(content: string, violations: readonly string[]): string {
    const block = formatSandboxViolations(violations);
    return block.length > 0 ? `${content}\n\n${block}` : content;
}

export function enqueueCommand(session: ShellSession, command: string): boolean {
    const payload = command.endsWith("\n") ? command : `${command}\n`;
    if (
        session.commandQueue.length >= MAX_STDIN_QUEUE_COMMANDS
        || session.commandQueueChars + payload.length > MAX_STDIN_QUEUE_CHARS
    ) {
        return false;
    }
    session.commandQueue.push(payload);
    session.commandQueueChars += payload.length;
    flushCommandQueue(session);
    return true;
}

export function waitForSession(
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

export async function interruptSession(session: ShellSession): Promise<void> {
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

export async function stopSession(session: ShellSession): Promise<ShellSessionExit> {
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
        intercepted: session.sandbox?.intercepted ?? false,
        violations: takeViolations(session)
    };
}

export function taskSnapshot(session: ShellSession): ToolTaskSnapshot {
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

export function sessionDisplayOutput(session: ShellSession): string {
    return formatTruncatedOutput(session.output, session.truncatedCharacters);
}

export function sessionStatus(session: ShellSession): "running" | "completed" | "failed" {
    if (session.error) {
        return "failed";
    }
    if (!session.ended) {
        return "running";
    }
    return session.exitCode === 0 ? "completed" : "failed";
}

function flushCommandQueue(session: ShellSession): void {
    if (session.ended || session.writing || !session.child.stdin.writable) {
        return;
    }

    while (session.commandQueue.length > 0) {
        const command = session.commandQueue.shift()!;
        session.commandQueueChars -= command.length;
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
            session.error = error instanceof Error ? error.message : String(error);
            session.finish();
            return;
        }
    }
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
