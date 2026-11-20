import {
    permissionGrantInputSchema,
    type PermissionDirectoryChange,
    type PermissionDomainChange,
    type PermissionRequestStatus
} from "../../../protocol/permission.ts";
import type { ToolCallStatus } from "../shared/view.ts";

export const REQUEST_PERMISSION_TOOL = "request_permission";

export type PermissionRequestView = {
    kind: "permission.request";
    domains: PermissionDomainChange[];
    directories: PermissionDirectoryChange[];
    decision: PermissionRequestStatus;
    output: string;
    status: ToolCallStatus;
};

export function createPermissionRequestToolCallViewData(
    name: string,
    arguments_: Record<string, unknown>,
    status: ToolCallStatus = "pending"
): PermissionRequestView | null {
    if (name !== REQUEST_PERMISSION_TOOL) {
        return null;
    }
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

export function isPermissionRequestView(value: Record<string, unknown>): boolean {
    return value.kind === "permission.request"
        && isPermissionRequestStatus(value.decision)
        && permissionGrantInputSchema.safeParse({
            domains: value.domains,
            directories: value.directories
        }).success;
}

function isPermissionRequestStatus(value: unknown): value is PermissionRequestStatus {
    return value === "pending" || value === "approved" || value === "cancelled";
}
