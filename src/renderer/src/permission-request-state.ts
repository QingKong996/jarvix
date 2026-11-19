import type { PermissionRequest } from "../../protocol/permission.ts";

export type ActivePermissionRequest = {
    sessionId: string;
    request: PermissionRequest;
};

export function isCurrentPermissionRequest(
    current: ActivePermissionRequest | null,
    sessionId?: string,
    requestId?: string
): boolean {
    return current !== null
        && (sessionId === undefined || current.sessionId === sessionId)
        && (requestId === undefined || current.request.id === requestId);
}
