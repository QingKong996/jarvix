import type {
    FilesystemPathEntry,
    SandboxRuntimeConfig
} from "@anthropic-ai/sandbox-runtime";
import type { PermissionRules } from "../core/execution/sandbox.ts";

export type SandboxPolicy = Pick<SandboxRuntimeConfig, "filesystem" | "network">;

/** Translate effective permission rules into restrictions enforced by the sandbox runtime. */
export function createSandboxPolicy(
    rules: PermissionRules | null
): SandboxPolicy | null {
    if (rules === null) {
        return null;
    }
    return {
        filesystem: {
            denyRead: literalPaths(rules.directories.read.deny),
            allowRead: literalPaths(rules.directories.read.allow),
            allowWrite: literalPaths(rules.directories.write.allow),
            denyWrite: literalPaths(rules.directories.write.deny)
        },
        network: {
            allowedDomains: [...rules.domains.allow],
            deniedDomains: [...rules.domains.deny]
        }
    };
}

function literalPaths(paths: readonly string[]): FilesystemPathEntry[] {
    return paths.map((path) => ({
        path,
        literal: true
    }));
}
