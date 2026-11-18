import { resolve } from "node:path";
import { expect, test } from "vitest";
import { SessionPermissions } from "./session-permissions.ts";
import { createSandboxPolicy } from "./sandbox.ts";

const directory = resolve("approved-directory");

test("approval adds session grants to subsequent sandbox policies", async () => {
    const permissions = new SessionPermissions();
    const handle = permissions.begin({
        domains: [{ action: "enable", domain: "api.example.com" }],
        directories: [{ action: "enable", access: "write", path: directory }]
    });

    expect(permissions.respond(handle.request.id, "approved")).toBe(true);
    await expect(handle.decision).resolves.toBe("approved");

    const base = createSandboxPolicy("read-only", []);
    const policy = permissions.apply(base);

    expect(policy?.network.allowedDomains).toEqual(["api.example.com"]);
    expect(policy?.filesystem.allowWrite).toEqual([{
        path: directory,
        literal: true
    }]);
    expect(base?.network.allowedDomains).toEqual([]);
    expect(base?.filesystem.allowWrite).toEqual([]);
});

test("cancellation leaves the sandbox policy unchanged", async () => {
    const permissions = new SessionPermissions();
    const handle = permissions.begin({
        domains: [{ action: "enable", domain: "api.example.com" }],
        directories: [{ action: "enable", access: "write", path: directory }]
    });

    expect(permissions.respond(handle.request.id, "cancelled")).toBe(true);
    await expect(handle.decision).resolves.toBe("cancelled");

    const policy = permissions.apply(createSandboxPolicy("read-only", []));
    expect(policy?.network.allowedDomains).toEqual([]);
    expect(policy?.filesystem.allowWrite).toEqual([]);
});

test("reports releasable only without pending requests or session grants", () => {
    const permissions = new SessionPermissions();
    expect(permissions.canRelease()).toBe(true);

    const pending = permissions.begin({
        domains: [{ action: "enable", domain: "api.example.com" }],
        directories: []
    });
    expect(permissions.canRelease()).toBe(false);
    permissions.respond(pending.request.id, "cancelled");
    expect(permissions.canRelease()).toBe(true);

    const approved = permissions.begin({
        domains: [],
        directories: [{ action: "enable", access: "write", path: directory }]
    });
    permissions.respond(approved.request.id, "approved");
    expect(permissions.canRelease()).toBe(false);

    permissions.reset();
    expect(permissions.canRelease()).toBe(true);
});

test("aborting a task cancels its pending request", async () => {
    const permissions = new SessionPermissions();
    const controller = new AbortController();
    const handle = permissions.begin({
        domains: [{ action: "enable", domain: "api.example.com" }],
        directories: []
    }, controller.signal);

    controller.abort();

    await expect(handle.decision).resolves.toBe("cancelled");
    expect(permissions.respond(handle.request.id, "approved")).toBe(false);
});

test("reset clears grants and cancels pending requests", async () => {
    const permissions = new SessionPermissions();
    const approved = permissions.begin({
        domains: [{ action: "enable", domain: "api.example.com" }],
        directories: [{ action: "enable", access: "write", path: directory }]
    });
    permissions.respond(approved.request.id, "approved");

    const pending = permissions.begin({
        domains: [{ action: "enable", domain: "other.example.com" }],
        directories: []
    });
    permissions.reset();

    await expect(pending.decision).resolves.toBe("cancelled");
    expect(permissions.respond(pending.request.id, "approved")).toBe(false);
    const policy = permissions.apply(createSandboxPolicy("read-only", []));
    expect(policy?.network.allowedDomains).toEqual([]);
    expect(policy?.filesystem.allowWrite).toEqual([]);
});

test("applies and reverses every domain and filesystem access change", async () => {
    const permissions = new SessionPermissions();
    const readEnabled = resolve("read-enabled");
    const readDisabled = resolve("read-disabled");
    const writeEnabled = resolve("write-enabled");
    const writeDisabled = resolve("write-disabled");

    const first = permissions.begin({
        domains: [
            { action: "enable", domain: "api.example.com" },
            { action: "disable", domain: "old.example.com" }
        ],
        directories: [
            { action: "enable", access: "read", path: readEnabled },
            { action: "disable", access: "read", path: readDisabled },
            { action: "enable", access: "write", path: writeEnabled },
            { action: "disable", access: "write", path: writeDisabled }
        ]
    });
    permissions.respond(first.request.id, "approved");

    let policy = permissions.apply(createSandboxPolicy("read-only", []));
    expect(policy?.network).toMatchObject({
        allowedDomains: ["api.example.com"],
        deniedDomains: ["old.example.com"]
    });
    expect(policy?.filesystem).toMatchObject({
        allowRead: [{ path: readEnabled, literal: true }],
        denyRead: [{ path: readDisabled, literal: true }],
        allowWrite: [{ path: writeEnabled, literal: true }],
        denyWrite: [{ path: writeDisabled, literal: true }]
    });

    const second = permissions.begin({
        domains: [
            { action: "disable", domain: "api.example.com" },
            { action: "enable", domain: "old.example.com" }
        ],
        directories: [
            { action: "disable", access: "read", path: readEnabled },
            { action: "enable", access: "read", path: readDisabled },
            { action: "disable", access: "write", path: writeEnabled },
            { action: "enable", access: "write", path: writeDisabled }
        ]
    });
    permissions.respond(second.request.id, "approved");

    policy = permissions.apply(createSandboxPolicy("read-only", []));
    expect(policy?.network).toMatchObject({
        allowedDomains: ["old.example.com"],
        deniedDomains: ["api.example.com"]
    });
    expect(policy?.filesystem).toMatchObject({
        allowRead: [{ path: readDisabled, literal: true }],
        denyRead: [{ path: readEnabled, literal: true }],
        allowWrite: [{ path: writeDisabled, literal: true }],
        denyWrite: [{ path: writeEnabled, literal: true }]
    });
});

test.skipIf(process.platform !== "win32")(
    "replaces case variants of a Windows path when access is reversed",
    () => {
        const permissions = new SessionPermissions();
        const path = resolve("PermissionCase");
        const otherCase = path.replace(/[A-Za-z]/g, (character) =>
            character === character.toLowerCase()
                ? character.toUpperCase()
                : character.toLowerCase()
        );
        expect(otherCase).not.toBe(path);

        const disable = permissions.begin({
            domains: [],
            directories: [{ action: "disable", access: "write", path }]
        });
        permissions.respond(disable.request.id, "approved");
        let policy = permissions.apply(createSandboxPolicy("read-only", []));
        expect(policy?.filesystem.denyWrite).toEqual([{ path, literal: true }]);

        const enable = permissions.begin({
            domains: [],
            directories: [{ action: "enable", access: "write", path: otherCase }]
        });
        permissions.respond(enable.request.id, "approved");
        policy = permissions.apply(createSandboxPolicy("read-only", []));
        expect(policy?.filesystem.allowWrite).toEqual([{ path: otherCase, literal: true }]);
        expect(policy?.filesystem.denyWrite).toEqual([]);
    }
);
