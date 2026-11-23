import { z } from "zod";
import type { LlmToolDefinition } from "../../../protocol/llm.ts";
import {
    MAX_STDIN_COMMAND_CHARS
} from "./limits.ts";
import { shellDisplayName } from "./launch.ts";
import {
    EXEC_COMMAND_TOOL,
    WRITE_STDIN_TOOL
} from "./view.ts";

const MAX_TIMEOUT_MS = 2_147_483_647;

export const execCommandArguments = z.object({
    command: z.string().trim().min(1),
    cwd: z.string().trim().min(1),
    timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS)
});

export const writeStdinArguments = z.object({
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
