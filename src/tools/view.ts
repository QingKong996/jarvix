import type { LlmJsonObject } from "../llm/types.ts";

export const EXEC_COMMAND_TOOL = "exec_command";
export const WRITE_STDIN_TOOL = "write_stdin";
export const APPLY_PATCH_TOOL = "apply_patch";

export type ToolCallStatus = "pending" | "running" | "completed" | "timed_out" | "failed";

export type ShellExecCommandView = {
    kind: "shell.exec_command";
    command: string;
    output: string;
    status: ToolCallStatus;
};

export type ShellWriteStdinView = {
    kind: "shell.write_stdin";
    sessionId: string;
    command: string;
    output: string;
    status: ToolCallStatus;
};

export type GenericToolView = {
    kind: "generic";
    name: string;
    arguments: Record<string, unknown>;
    output: string;
    status: ToolCallStatus;
};

export type ApplyPatchView = {
    kind: "apply_patch";
    patch: string;
    cwd: string;
    output: string;
    status: ToolCallStatus;
};

export type ToolCallViewData = ShellExecCommandView | ShellWriteStdinView | ApplyPatchView | GenericToolView;

export type ToolCallOutputDelta =
    | { kind: "shell.exec_command"; output: string }
    | { kind: "shell.write_stdin"; output: string }
    | { kind: "generic"; output: string };

export function createToolCallViewData(
    name: string,
    arguments_: Record<string, unknown>,
    status: ToolCallStatus = "pending"
): ToolCallViewData {
    switch (name) {
        case EXEC_COMMAND_TOOL:
            return {
                kind: "shell.exec_command",
                command: stringArgument(arguments_.command),
                output: "",
                status
            };
        case WRITE_STDIN_TOOL:
            return {
                kind: "shell.write_stdin",
                sessionId: stringArgument(arguments_.sessionId),
                command: stringArgument(arguments_.command),
                output: "",
                status
            };
        case APPLY_PATCH_TOOL: {
            const patch = stringArgument(arguments_.patch);
            return {
                kind: "apply_patch",
                patch,
                cwd: stringArgument(arguments_.cwd),
                output: "",
                status
            };
        }
        default:
            return {
                kind: "generic",
                name,
                arguments: arguments_,
                output: "",
                status
            };
    }
}

export function appendToolOutput(data: ToolCallViewData, delta: ToolCallOutputDelta): ToolCallViewData {
    if (data.kind !== delta.kind) {
        return data;
    }
    return { ...data, output: data.output + delta.output };
}

export function toToolResultDetails(data: ToolCallViewData): LlmJsonObject {
    return data as unknown as LlmJsonObject;
}

export function isToolCallViewData(value: unknown): value is ToolCallViewData {
    if (!isRecord(value) || !isToolCallStatus(value.status) || typeof value.output !== "string") {
        return false;
    }

    switch (value.kind) {
        case "shell.exec_command":
            return typeof value.command === "string";
        case "shell.write_stdin":
            return typeof value.command === "string" && typeof value.sessionId === "string";
        case "apply_patch":
            return typeof value.patch === "string"
                && typeof value.cwd === "string";
        case "generic":
            return typeof value.name === "string" && isRecord(value.arguments);
        default:
            return false;
    }
}

function stringArgument(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function isToolCallStatus(value: unknown): value is ToolCallStatus {
    return value === "pending"
        || value === "running"
        || value === "completed"
        || value === "timed_out"
        || value === "failed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
