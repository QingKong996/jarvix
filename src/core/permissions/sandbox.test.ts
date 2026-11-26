import { resolve } from "node:path";
import { expect, test } from "vitest";
import { createSandboxPolicy } from "./sandbox.ts";

const workingDirectories = ["workspace-a", "workspace-a", "workspace-b"];
const resolvedWorkingDirectories = [...new Set(
    workingDirectories.map((directory) => resolve(directory))
)];

test.each([
    ["read-only", resolvedWorkingDirectories, []],
    ["project-read-write", [], resolvedWorkingDirectories],
    ["auto-review", [], resolvedWorkingDirectories]
] as const)("maps %s to filesystem restrictions", (permission, allowRead, allowWrite) => {
    const policy = createSandboxPolicy(permission, workingDirectories);

    expect(policy?.filesystem).toEqual({
        denyRead: [],
        allowRead,
        allowWrite,
        denyWrite: []
    });
    expect(policy?.network).toEqual({
        allowedDomains: [],
        deniedDomains: []
    });
});

test("full access bypasses the sandbox", () => {
    expect(createSandboxPolicy("full-access", workingDirectories)).toBeNull();
});
