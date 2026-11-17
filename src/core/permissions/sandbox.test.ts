import { resolve } from "node:path";
import { expect, test } from "vitest";
import { createSandboxPolicy } from "./sandbox.ts";

const workingDirectories = ["workspace-a", "workspace-a", "workspace-b"];
const resolvedWorkingDirectories = [...new Set(
    workingDirectories.map((directory) => resolve(directory))
)];

test.each([
    ["read-only", []],
    ["project-read-write", resolvedWorkingDirectories],
    ["auto-review", resolvedWorkingDirectories]
] as const)("maps %s to filesystem write restrictions", (permission, expected) => {
    const policy = createSandboxPolicy(permission, workingDirectories);

    expect(policy?.filesystem).toEqual({
        denyRead: [],
        allowWrite: expected,
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
