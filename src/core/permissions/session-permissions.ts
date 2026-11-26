import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type {
    PermissionAction,
    PermissionDecision,
    PermissionDirectoryChange,
    PermissionGrantInput,
    PermissionRequest
} from "../../protocol/permission.ts";
import { permissionPathKey } from "./path-key.ts";
import type { PermissionRules } from "./rules.ts";

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
            this.applyDirectoryChanges(pending.request.directories);
        }
        pending.settle(decision);
        return true;
    }

    /** Add user-selected paths without creating a permission prompt. */
    grantDirectories(changes: readonly PermissionDirectoryChange[]): void {
        this.applyDirectoryChanges(changes);
    }

    grants(): PermissionRules {
        return {
            domains: {
                allow: [...this.enabledDomains],
                deny: [...this.disabledDomains]
            },
            directories: {
                read: {
                    allow: [...this.enabledReadDirectories],
                    deny: [...this.disabledReadDirectories]
                },
                write: {
                    allow: [...this.enabledWriteDirectories],
                    deny: [...this.disabledWriteDirectories]
                }
            }
        };
    }

    hasPending(): boolean {
        return this.pending.size > 0;
    }

    canRelease(): boolean {
        return this.pending.size === 0
            && this.enabledDomains.size === 0
            && this.disabledDomains.size === 0
            && this.enabledReadDirectories.size === 0
            && this.disabledReadDirectories.size === 0
            && this.enabledWriteDirectories.size === 0
            && this.disabledWriteDirectories.size === 0;
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

    private applyDirectoryChanges(
        changes: readonly PermissionDirectoryChange[]
    ): void {
        for (const change of changes) {
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
