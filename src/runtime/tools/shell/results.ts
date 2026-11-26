import type { SandboxReadiness } from "../../../core/execution/sandbox.ts";
import { appendSandboxViolations } from "../../../core/permissions/violations.ts";
import type { LlmToolCallBlock } from "../../../protocol/llm.ts";
import type { ToolExecutionResult } from "../types.ts";
import { createGenericToolCallViewData } from "../tool-view.ts";
import {
    createShellToolCallViewData,
    type ShellExecCommandView
} from "./view.ts";
import {
    appendViolationContent,
    sessionDisplayOutput,
    sessionStatus,
    takeViolations,
    type ShellSession,
    type WriteCommandState
} from "./session.ts";

export function finishedResult(command: string, session: ShellSession): ToolExecutionResult {
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

export function invalidArgumentsResult(
    call: LlmToolCallBlock,
    message: string
): ToolExecutionResult {
    const data = createShellToolCallViewData(call.name, call.arguments, "failed")
        ?? createGenericToolCallViewData(call.name, call.arguments, "failed");
    return {
        content: `Invalid arguments for ${call.name}: ${message}`,
        data: { ...data, output: message },
        isError: true,
        endReason: "exited"
    };
}

export function sessionLimitResult(command: string, limit: number): ToolExecutionResult {
    const message = [
        `Shell session limit reached (${limit} active or retained sessions).`,
        "Drain or finish an existing background session with write_stdin before starting another command."
    ].join(" ");
    return failedExecResult(command, message);
}

export function sharedSessionLimitResult(
    command: string,
    limit: number
): ToolExecutionResult {
    const message = [
        `Application-wide shell session limit reached (${limit} active or retained sessions across all conversations).`,
        "Drain or finish a background session with write_stdin, or stop its conversation, before starting another command."
    ].join(" ");
    return failedExecResult(command, message);
}

export function sandboxPreflightResult(
    command: string,
    preflight: Extract<SandboxReadiness, { ready: false }>
): ToolExecutionResult {
    const message = [
        "The command was not executed because the local sandbox is not ready.",
        ...preflight.errors,
        "Install or repair the Windows sandbox from Jarvix, then retry.",
        "This is a host setup problem, not a permission-mode denial."
    ].join("\n\n");
    return failedExecResult(command, message);
}

export function timedOutContent(
    sessionId: string,
    timeoutMs: number,
    output: string
): string {
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

export function writeResultContent(
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
            : commandState === "overflowed"
                ? "The stdin command was not queued because the pending input buffer is full. Poll with write_stdin before sending more input."
                : "The stdin command was not executed because the shell has already exited.";
    const buffer = output.length > 0
        ? `Buffered output returned:\n${output}`
        : "No buffered output was available.";
    const ending = status === "running"
        ? "The task has not ended. New output will be buffered and broadcast; use write_stdin again to retrieve it."
        : "The buffered output has been drained.";
    return [state, command, buffer, ending].join("\n");
}

function failedExecResult(command: string, message: string): ToolExecutionResult {
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

function finishedContent(
    exitCode: number | null,
    error: string | null,
    output: string
): string {
    const header = error ? `Command failed: ${error}` : `Command exited with code ${exitCode ?? "unknown"}.`;
    return `${header}\nOutput:\n${output}`;
}
