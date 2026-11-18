import type { LlmJsonObject } from "../../llm/types.ts";
import {
    permissionGrantInputSchema,
    type PermissionDirectoryChange,
    type PermissionDomainChange,
    type PermissionRequestStatus
} from "../../protocol/permission.ts";
import { appendBoundedOutput } from "./output.ts";

export const EXEC_COMMAND_TOOL = "exec_command";
export const WRITE_STDIN_TOOL = "write_stdin";
export const APPLY_PATCH_TOOL = "apply_patch";
export const LOCAL_TIME_TOOL = "get_local_time";
export const SLEEP_TOOL = "sleep";
export const REQUEST_PERMISSION_TOOL = "request_permission";

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

export type LocalTimeView = {
    kind: "time.local_time";
    localTime: string;
    timeZone: string;
    utcOffset: string;
    epochMillis: number;
    output: string;
    status: ToolCallStatus;
};

export type SleepView = {
    kind: "time.sleep";
    durationMs: number;
    startedAt: number;
    elapsedMs: number;
    output: string;
    status: ToolCallStatus;
};

export type PermissionRequestView = {
    kind: "permission.request";
    domains: PermissionDomainChange[];
    directories: PermissionDirectoryChange[];
    decision: PermissionRequestStatus;
    output: string;
    status: ToolCallStatus;
};

export type ToolCallViewData =
    | ShellExecCommandView
    | ShellWriteStdinView
    | ApplyPatchView
    | LocalTimeView
    | SleepView
    | PermissionRequestView
    | GenericToolView;

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
        case LOCAL_TIME_TOOL:
            return {
                kind: "time.local_time",
                localTime: "",
                timeZone: "",
                utcOffset: "",
                epochMillis: 0,
                output: "",
                status
            };
        case SLEEP_TOOL:
            return {
                kind: "time.sleep",
                durationMs: numberArgument(arguments_.durationMs),
                startedAt: Date.now(),
                elapsedMs: 0,
                output: "",
                status
            };
        case REQUEST_PERMISSION_TOOL: {
            const parsed = permissionGrantInputSchema.safeParse(arguments_);
            return {
                kind: "permission.request",
                domains: parsed.success ? parsed.data.domains : [],
                directories: parsed.success ? parsed.data.directories : [],
                decision: "pending",
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
    return { ...data, output: appendBoundedOutput(data.output, delta.output) };
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
        case "time.local_time":
            return typeof value.localTime === "string"
                && typeof value.timeZone === "string"
                && typeof value.utcOffset === "string"
                && typeof value.epochMillis === "number";
        case "time.sleep":
            return typeof value.durationMs === "number"
                && typeof value.startedAt === "number"
                && typeof value.elapsedMs === "number";
        case "permission.request":
            return isPermissionRequestStatus(value.decision)
                && permissionGrantInputSchema.safeParse({
                    domains: value.domains,
                    directories: value.directories
                }).success;
        case "generic":
            return typeof value.name === "string" && isRecord(value.arguments);
        default:
            return false;
    }
}

function stringArgument(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function numberArgument(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isToolCallStatus(value: unknown): value is ToolCallStatus {
    return value === "pending"
        || value === "running"
        || value === "completed"
        || value === "timed_out"
        || value === "failed";
}

function isPermissionRequestStatus(value: unknown): value is PermissionRequestStatus {
    return value === "pending" || value === "approved" || value === "cancelled";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
