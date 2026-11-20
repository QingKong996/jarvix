import {
    stringArgument,
    type ToolCallStatus
} from "../shared/view.ts";

export const EXEC_COMMAND_TOOL = "exec_command";
export const WRITE_STDIN_TOOL = "write_stdin";

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

export type ShellToolCallViewData = ShellExecCommandView | ShellWriteStdinView;

export type ShellToolCallOutputDelta =
    | { kind: "shell.exec_command"; output: string }
    | { kind: "shell.write_stdin"; output: string };

export function createShellToolCallViewData(
    name: string,
    arguments_: Record<string, unknown>,
    status: ToolCallStatus = "pending"
): ShellToolCallViewData | null {
    if (name === EXEC_COMMAND_TOOL) {
        return {
            kind: "shell.exec_command",
            command: stringArgument(arguments_.command),
            output: "",
            status
        };
    }
    if (name === WRITE_STDIN_TOOL) {
        return {
            kind: "shell.write_stdin",
            sessionId: stringArgument(arguments_.sessionId),
            command: stringArgument(arguments_.command),
            output: "",
            status
        };
    }
    return null;
}

export function isShellToolCallViewData(value: Record<string, unknown>): boolean {
    if (value.kind === "shell.exec_command") {
        return typeof value.command === "string";
    }
    if (value.kind === "shell.write_stdin") {
        return typeof value.command === "string" && typeof value.sessionId === "string";
    }
    return false;
}
