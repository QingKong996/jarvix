import { resolve } from "node:path";
import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import type { PermissionMode } from "../../protocol/permission.ts";

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
    // Uses workspace-write rules until an approval coordinator is available.
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

    const allowWrite = profile.writable === "workspace"
        ? [...new Set(workingDirectories.map((directory) => resolve(directory)))]
        : [];
    return {
        filesystem: {
            denyRead: [],
            allowWrite,
            denyWrite: []
        },
        network: {
            allowedDomains: [],
            deniedDomains: []
        }
    };
}
