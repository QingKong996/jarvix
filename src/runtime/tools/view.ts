import type { LlmJsonObject } from "../../protocol/llm.ts";
import {
    APPLY_PATCH_TOOL,
    createApplyPatchToolCallViewData,
    isApplyPatchView,
    type ApplyPatchView
} from "./apply-patch/view.ts";
import {
    createPermissionRequestToolCallViewData,
    isPermissionRequestView,
    REQUEST_PERMISSION_TOOL,
    type PermissionRequestView
} from "./request-permission/view.ts";
import {
    createShellToolCallViewData,
    EXEC_COMMAND_TOOL,
    isShellToolCallViewData,
    WRITE_STDIN_TOOL,
    type ShellExecCommandView,
    type ShellToolCallOutputDelta,
    type ShellToolCallViewData,
    type ShellWriteStdinView
} from "./shell/view.ts";
import {
    appendToolViewOutput,
    createGenericToolCallViewData,
    isToolCallViewBase,
    type GenericToolView,
    type ToolCallStatus
} from "./tool-view.ts";
import {
    createTimeToolCallViewData,
    isTimeToolCallViewData,
    LOCAL_TIME_TOOL,
    SLEEP_TOOL,
    type LocalTimeView,
    type SleepView,
    type TimeToolCallViewData
} from "./time/view.ts";

export {
    APPLY_PATCH_TOOL,
    EXEC_COMMAND_TOOL,
    LOCAL_TIME_TOOL,
    REQUEST_PERMISSION_TOOL,
    SLEEP_TOOL,
    WRITE_STDIN_TOOL
};
export type {
    ApplyPatchView,
    GenericToolView,
    LocalTimeView,
    PermissionRequestView,
    ShellExecCommandView,
    ShellWriteStdinView,
    SleepView,
    ToolCallStatus
};

export type ToolCallViewData =
    | ShellToolCallViewData
    | ApplyPatchView
    | TimeToolCallViewData
    | PermissionRequestView
    | GenericToolView;

export type ToolCallOutputDelta =
    | ShellToolCallOutputDelta
    | { kind: "generic"; output: string };

const toolCallViewFactories = [
    createShellToolCallViewData,
    createApplyPatchToolCallViewData,
    createTimeToolCallViewData,
    createPermissionRequestToolCallViewData
];

const toolCallViewValidators = [
    isShellToolCallViewData,
    isApplyPatchView,
    isTimeToolCallViewData,
    isPermissionRequestView
];

export function createToolCallViewData(
    name: string,
    arguments_: Record<string, unknown>,
    status: ToolCallStatus = "pending"
): ToolCallViewData {
    for (const create of toolCallViewFactories) {
        const data = create(name, arguments_, status);
        if (data) {
            return data;
        }
    }
    return createGenericToolCallViewData(name, arguments_, status);
}

export function appendToolOutput(
    data: ToolCallViewData,
    delta: ToolCallOutputDelta
): ToolCallViewData {
    return appendToolViewOutput(data, delta);
}

export function toToolResultDetails(data: ToolCallViewData): LlmJsonObject {
    return data as unknown as LlmJsonObject;
}

export function isToolCallViewData(value: unknown): value is ToolCallViewData {
    if (!isToolCallViewBase(value)) {
        return false;
    }
    if (value.kind === "generic") {
        return typeof value.name === "string" && isRecord(value.arguments);
    }
    return toolCallViewValidators.some((isView) => isView(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
