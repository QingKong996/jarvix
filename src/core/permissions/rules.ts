import { resolve } from "node:path";
import type { PermissionMode } from "../../protocol/permission.ts";
import { permissionPathKey } from "./path-key.ts";

export type PermissionAccessRules = {
    readonly allow: readonly string[];
    readonly deny: readonly string[];
};

/** Effective allow/deny rules consumed by the sandbox implementation. */
export type PermissionRules = {
    readonly domains: PermissionAccessRules;
    readonly directories: {
        readonly read: PermissionAccessRules;
        readonly write: PermissionAccessRules;
    };
};

export function createPermissionRules(
    permission: PermissionMode,
    workingDirectories: readonly string[],
    readableDirectories: readonly string[] = []
): PermissionRules | null {
    if (permission === "full-access") {
        return null;
    }

    const workspace = uniquePaths(workingDirectories.map((path) => resolve(path)));
    const readable = uniquePaths([
        ...workspace,
        ...readableDirectories.map((path) => resolve(path))
    ]);
    const readOnly = permission === "read-only";
    return {
        domains: emptyAccessRules(),
        directories: {
            read: {
                allow: readOnly ? readable : readableDirectories.map(
                    (path) => resolve(path)
                ),
                deny: []
            },
            write: {
                allow: readOnly ? [] : workspace,
                deny: []
            }
        }
    };
}

function emptyAccessRules(): PermissionAccessRules {
    return {
        allow: [],
        deny: []
    };
}

export function mergePermissionRules(
    base: PermissionRules | null,
    grants: PermissionRules
): PermissionRules | null {
    if (base === null) {
        return null;
    }
    return {
        domains: mergeAccessRules(base.domains, grants.domains, domainKey),
        directories: {
            read: mergeAccessRules(
                base.directories.read,
                grants.directories.read,
                permissionPathKey
            ),
            write: mergeAccessRules(
                base.directories.write,
                grants.directories.write,
                permissionPathKey
            )
        }
    };
}

function mergeAccessRules(
    base: PermissionAccessRules,
    grants: PermissionAccessRules,
    keyOf: (value: string) => string
): PermissionAccessRules {
    const allow = new Map<string, string>();
    const deny = new Map<string, string>();
    for (const value of base.allow) {
        allow.set(keyOf(value), value);
    }
    for (const value of base.deny) {
        deny.set(keyOf(value), value);
    }
    for (const value of grants.allow) {
        const key = keyOf(value);
        deny.delete(key);
        allow.set(key, value);
    }
    for (const value of grants.deny) {
        const key = keyOf(value);
        allow.delete(key);
        deny.set(key, value);
    }
    return {
        allow: [...allow.values()],
        deny: [...deny.values()]
    };
}

function uniquePaths(paths: readonly string[]): string[] {
    const seen = new Set<string>();
    return paths.filter((path) => {
        const key = permissionPathKey(path);
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function domainKey(domain: string): string {
    return domain.toLowerCase();
}
