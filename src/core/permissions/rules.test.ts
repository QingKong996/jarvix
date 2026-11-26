import { resolve } from "node:path";
import { expect, test } from "vitest";
import {
    createPermissionRules,
    mergePermissionRules
} from "./rules.ts";

const workingDirectories = ["workspace-a", "workspace-a", "workspace-b"];
const resolvedWorkingDirectories = [...new Set(
    workingDirectories.map((directory) => resolve(directory))
)];

test.each([
    ["read-only", resolvedWorkingDirectories, []],
    ["project-read-write", [], resolvedWorkingDirectories],
    ["auto-review", [], resolvedWorkingDirectories]
] as const)("maps %s to effective permission rules", (permission, allowRead, allowWrite) => {
    expect(createPermissionRules(permission, workingDirectories)).toEqual({
        domains: {
            allow: [],
            deny: []
        },
        directories: {
            read: {
                allow: allowRead,
                deny: []
            },
            write: {
                allow: allowWrite,
                deny: []
            }
        }
    });
});

test("full access has no permission rules", () => {
    expect(createPermissionRules("full-access", workingDirectories)).toBeNull();
});

test("session grants override base rules without changing the permission mode", () => {
    const base = createPermissionRules("read-only", workingDirectories);
    const extra = resolve("extra");
    const merged = mergePermissionRules(base, {
        domains: {
            allow: ["api.example.com"],
            deny: ["old.example.com"]
        },
        directories: {
            read: {
                allow: [extra],
                deny: [resolvedWorkingDirectories[0]!]
            },
            write: {
                allow: [extra],
                deny: []
            }
        }
    });

    expect(merged).toEqual({
        domains: {
            allow: ["api.example.com"],
            deny: ["old.example.com"]
        },
        directories: {
            read: {
                allow: [resolvedWorkingDirectories[1], extra],
                deny: [resolvedWorkingDirectories[0]]
            },
            write: {
                allow: [extra],
                deny: []
            }
        }
    });
});

test("full access ignores session grants", () => {
    expect(mergePermissionRules(null, {
        domains: {
            allow: ["api.example.com"],
            deny: []
        },
        directories: {
            read: {
                allow: [],
                deny: []
            },
            write: {
                allow: [],
                deny: []
            }
        }
    })).toBeNull();
});
