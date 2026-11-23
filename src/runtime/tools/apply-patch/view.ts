import {
    stringArgument,
    type ToolCallStatus
} from "../tool-view.ts";

export const APPLY_PATCH_TOOL = "apply_patch";

export type ApplyPatchView = {
    kind: "apply_patch";
    patch: string;
    cwd: string;
    output: string;
    status: ToolCallStatus;
};

export function createApplyPatchToolCallViewData(
    name: string,
    arguments_: Record<string, unknown>,
    status: ToolCallStatus = "pending"
): ApplyPatchView | null {
    if (name !== APPLY_PATCH_TOOL) {
        return null;
    }
    return {
        kind: "apply_patch",
        patch: stringArgument(arguments_.patch),
        cwd: stringArgument(arguments_.cwd),
        output: "",
        status
    };
}

export function isApplyPatchView(value: Record<string, unknown>): boolean {
    return value.kind === "apply_patch"
        && typeof value.patch === "string"
        && typeof value.cwd === "string";
}
