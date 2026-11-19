import { expect, test } from "vitest";
import type { PermissionRequest } from "../../protocol/permission.ts";
import {
    isCurrentPermissionRequest,
    type ActivePermissionRequest
} from "./permission-request-state.ts";

function permissionRequest(id: string): PermissionRequest {
    return {
        id,
        domains: [],
        directories: []
    };
}

test("does not treat a delayed response as owning a newer permission request", () => {
    const current: ActivePermissionRequest = {
        sessionId: "session-1",
        request: permissionRequest("request-2")
    };

    expect(isCurrentPermissionRequest(current, "session-1", "request-1")).toBe(false);
    expect(isCurrentPermissionRequest(current, "session-1", "request-2")).toBe(true);
});

test("keeps session-only and unconditional clearing for navigation", () => {
    const current: ActivePermissionRequest = {
        sessionId: "session-1",
        request: permissionRequest("request-1")
    };

    expect(isCurrentPermissionRequest(current, "session-1")).toBe(true);
    expect(isCurrentPermissionRequest(current, "session-2")).toBe(false);
    expect(isCurrentPermissionRequest(current)).toBe(true);
    expect(isCurrentPermissionRequest(null)).toBe(false);
});
