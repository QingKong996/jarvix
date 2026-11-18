import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type {
    PermissionAction,
    PermissionDecision,
    PermissionDirectoryChange,
    PermissionDomainChange,
    PermissionGrantInput,
    PermissionRequest
} from "../../protocol/permission.ts";
import { permissionPathKey } from "./path-key.ts";
import { applyPermissionGrants, type SandboxPolicy } from "./sandbox.ts";

type PendingPermission = {
    request: PermissionRequest;
    signal?: AbortSignal;
    abortListener?: () => void;
    settle(decision: PermissionDecision): void;
};

export type PermissionRequestHandle = {
    request: PermissionRequest;
    decision: Promise<PermissionDecision>;
};

/** Session-scoped access grants and pending approval requests. */
export class SessionPermissions {
    private readonly enabledDomains = new Set<string>();
    private readonly disabledDomains = new Set<string>();
    private readonly enabledReadDirectories = new Set<string>();
    private readonly disabledReadDirectories = new Set<string>();
    private readonly enabledWriteDirectories = new Set<string>();
    private readonly disabledWriteDirectories = new Set<string>();
    private readonly pending = new Map<string, PendingPermission>();

    begin(input: PermissionGrantInput, signal?: AbortSignal): PermissionRequestHandle {
        const request: PermissionRequest = {
            id: randomUUID(),
            domains: input.domains.map((change) => ({ ...change })),
            directories: input.directories.map((change) => ({ ...change }))
        };
        let resolveDecision!: (decision: PermissionDecision) => void;
        const decision = new Promise<PermissionDecision>((resolvePromise) => {
            resolveDecision = resolvePromise;
        });
        const pending: PendingPermission = {
            request,
            signal,
            settle: (result) => {
                this.finish(request.id);
                resolveDecision(result);
            }
        };
        if (signal) {
            pending.abortListener = () => pending.settle("cancelled");
            signal.addEventListener("abort", pending.abortListener, { once: true });
        }
        this.pending.set(request.id, pending);
        if (signal?.aborted) {
            pending.settle("cancelled");
        }
        return { request, decision };
    }

    respond(requestId: string, decision: PermissionDecision): boolean {
        const pending = this.pending.get(requestId);
        if (!pending) {
            return false;
        }
        if (decision === "approved") {
            for (const change of pending.request.domains) {
                setChange(
                    this.enabledDomains,
                    this.disabledDomains,
                    change.domain.toLowerCase(),
                    change.action,
                    domainKey
                );
            }
            for (const change of pending.request.directories) {
                if (change.access === "read") {
                    setChange(
                        this.enabledReadDirectories,
                        this.disabledReadDirectories,
                        resolve(change.path),
                        change.action,
                        permissionPathKey
                    );
                } else {
                    setChange(
                        this.enabledWriteDirectories,
                        this.disabledWriteDirectories,
                        resolve(change.path),
                        change.action,
                        permissionPathKey
                    );
                }
            }
        }
        pending.settle(decision);
        return true;
    }

    apply(policy: SandboxPolicy | null): SandboxPolicy | null {
        return applyPermissionGrants(policy, sessionChanges(
            this.enabledDomains,
            this.disabledDomains,
            this.enabledReadDirectories,
            this.disabledReadDirectories,
            this.enabledWriteDirectories,
            this.disabledWriteDirectories
        ));
    }

    reset(): void {
        this.enabledDomains.clear();
        this.disabledDomains.clear();
        this.enabledReadDirectories.clear();
        this.disabledReadDirectories.clear();
        this.enabledWriteDirectories.clear();
        this.disabledWriteDirectories.clear();
        for (const pending of [...this.pending.values()]) {
            pending.settle("cancelled");
        }
    }

    dispose(): void {
        this.reset();
    }

    private finish(requestId: string): void {
        const pending = this.pending.get(requestId);
        if (!pending) {
            return;
        }
        this.pending.delete(requestId);
        if (pending.signal && pending.abortListener) {
            pending.signal.removeEventListener("abort", pending.abortListener);
        }
    }
}

function sessionChanges(
    enabledDomains: ReadonlySet<string>,
    disabledDomains: ReadonlySet<string>,
    enabledReadDirectories: ReadonlySet<string>,
    disabledReadDirectories: ReadonlySet<string>,
    enabledWriteDirectories: ReadonlySet<string>,
    disabledWriteDirectories: ReadonlySet<string>
): PermissionGrantInput {
    const domains: PermissionDomainChange[] = [];
    for (const domain of enabledDomains) {
        domains.push({ action: "enable", domain });
    }
    for (const domain of disabledDomains) {
        domains.push({ action: "disable", domain });
    }

    const directories: PermissionDirectoryChange[] = [];
    for (const path of enabledReadDirectories) {
        directories.push({ action: "enable", access: "read", path });
    }
    for (const path of disabledReadDirectories) {
        directories.push({ action: "disable", access: "read", path });
    }
    for (const path of enabledWriteDirectories) {
        directories.push({ action: "enable", access: "write", path });
    }
    for (const path of disabledWriteDirectories) {
        directories.push({ action: "disable", access: "write", path });
    }
    return { domains, directories };
}

function setChange(
    enabled: Set<string>,
    disabled: Set<string>,
    value: string,
    action: PermissionAction,
    keyOf: (value: string) => string
): void {
    const key = keyOf(value);
    for (const current of enabled) {
        if (keyOf(current) === key) {
            enabled.delete(current);
        }
    }
    for (const current of disabled) {
        if (keyOf(current) === key) {
            disabled.delete(current);
        }
    }
    if (action === "enable") {
        enabled.add(value);
    } else {
        disabled.add(value);
    }
}

function domainKey(domain: string): string {
    return domain.toLowerCase();
}
