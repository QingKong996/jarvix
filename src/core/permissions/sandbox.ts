import { resolve } from "node:path";
import type {
    FilesystemPathEntry,
    SandboxRuntimeConfig
} from "@anthropic-ai/sandbox-runtime";
import type {
    PermissionGrantInput,
    PermissionMode
} from "../../protocol/permission.ts";
import { permissionPathKey } from "./path-key.ts";

export type SandboxPolicy = Pick<SandboxRuntimeConfig, "filesystem" | "network">;

type PermissionSandboxProfile = {
    sandboxed: boolean;
    writable: "none" | "workspace" | "all";
};

const SANDBOX_PROFILES: Record<PermissionMode, PermissionSandboxProfile> = {
    "read-only": {
        sandboxed: true,
        writable: "none"
    },
    "project-read-write": {
        sandboxed: true,
        writable: "workspace"
    },
    "full-access": {
        sandboxed: false,
        writable: "all"
    },
    // Uses workspace-write rules; request_permission can add session-scoped access.
    "auto-review": {
        sandboxed: true,
        writable: "workspace"
    }
};

/** Translate a permission mode into restrictions enforced by the sandbox runtime. */
export function createSandboxPolicy(
    permission: PermissionMode,
    workingDirectories: readonly string[]
): SandboxPolicy | null {
    const profile = SANDBOX_PROFILES[permission];
    if (!profile.sandboxed) {
        return null;
    }

    const workspacePaths = [...new Set(
        workingDirectories.map((directory) => resolve(directory))
    )];
    const allowRead = profile.writable === "none" ? workspacePaths : [];
    const allowWrite = profile.writable === "workspace" ? workspacePaths : [];
    return {
        filesystem: {
            denyRead: [],
            allowRead,
            allowWrite,
            denyWrite: []
        },
        network: {
            allowedDomains: [],
            deniedDomains: []
        }
    };
}

/** Add session-scoped approvals to a sandbox policy without changing its base mode. */
export function applyPermissionGrants(
    policy: SandboxPolicy | null,
    grants: PermissionGrantInput
): SandboxPolicy | null {
    if (policy === null) {
        return null;
    }

    const filesystem = {
        ...policy.filesystem,
        denyRead: [...policy.filesystem.denyRead],
        allowRead: [...(policy.filesystem.allowRead ?? [])],
        allowWrite: [...policy.filesystem.allowWrite],
        denyWrite: [...policy.filesystem.denyWrite]
    };
    const network = {
        ...policy.network,
        allowedDomains: [...policy.network.allowedDomains],
        deniedDomains: [...policy.network.deniedDomains]
    };

    for (const change of grants.domains) {
        if (change.action === "enable") {
            network.allowedDomains = addDomain(network.allowedDomains, change.domain);
            network.deniedDomains = removeDomain(network.deniedDomains, change.domain);
        } else {
            network.deniedDomains = addDomain(network.deniedDomains, change.domain);
            network.allowedDomains = removeDomain(network.allowedDomains, change.domain);
        }
    }

    for (const change of grants.directories) {
        if (change.access === "read") {
            if (change.action === "enable") {
                filesystem.allowRead = addPath(filesystem.allowRead, change.path);
                filesystem.denyRead = removePath(filesystem.denyRead, change.path);
            } else {
                filesystem.denyRead = addPath(filesystem.denyRead, change.path);
                filesystem.allowRead = removePath(filesystem.allowRead, change.path);
            }
        } else if (change.action === "enable") {
            filesystem.allowWrite = addPath(filesystem.allowWrite, change.path);
            filesystem.denyWrite = removePath(filesystem.denyWrite, change.path);
        } else {
            filesystem.denyWrite = addPath(filesystem.denyWrite, change.path);
            filesystem.allowWrite = removePath(filesystem.allowWrite, change.path);
        }
    }

    return {
        filesystem,
        network
    };
}

function addDomain(domains: readonly string[], domain: string): string[] {
    const seen = new Set<string>();
    return [...domains, domain].filter((value) => {
        const key = value.toLowerCase();
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function removeDomain(domains: readonly string[], domain: string): string[] {
    const key = domain.toLowerCase();
    return domains.filter((value) => value.toLowerCase() !== key);
}

function addPath(entries: readonly FilesystemPathEntry[], path: string): FilesystemPathEntry[] {
    return uniquePaths([
        ...removePath(entries, path),
        { path: resolve(path), literal: true }
    ]);
}

function removePath(
    entries: readonly FilesystemPathEntry[],
    path: string
): FilesystemPathEntry[] {
    const key = permissionPathKey(path);
    return entries.filter((entry) => permissionPathKey(pathOf(entry)) !== key);
}

function pathOf(entry: FilesystemPathEntry): string {
    return typeof entry === "string" ? entry : entry.path;
}

function uniquePaths(values: readonly FilesystemPathEntry[]): FilesystemPathEntry[] {
    const seen = new Set<string>();
    return values.filter((value) => {
        const path = typeof value === "string" ? value : value.path;
        const key = permissionPathKey(path);
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}
