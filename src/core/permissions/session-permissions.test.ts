import { resolve } from "node:path";
import { expect, test } from "vitest";
import { SessionPermissions } from "./session-permissions.ts";

const directory = resolve("approved-directory");

test("approval exposes session grants", async () => {
    const permissions = new SessionPermissions();
    const handle = permissions.begin({
        domains: [{ action: "enable", domain: "api.example.com" }],
        directories: [{ action: "enable", access: "write", path: directory }]
    });

    expect(permissions.respond(handle.request.id, "approved")).toBe(true);
    await expect(handle.decision).resolves.toBe("approved");

    expect(permissions.grants()).toEqual({
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
                allow: [directory],
                deny: []
            }
        }
    });
});

test("cancellation leaves grants empty", async () => {
    const permissions = new SessionPermissions();
    const handle = permissions.begin({
        domains: [{ action: "enable", domain: "api.example.com" }],
        directories: [{ action: "enable", access: "write", path: directory }]
    });

    expect(permissions.respond(handle.request.id, "cancelled")).toBe(true);
    await expect(handle.decision).resolves.toBe("cancelled");

    expect(permissions.grants()).toEqual({
        domains: {
            allow: [],
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
    });
});

test("grants selected paths without a pending approval", () => {
    const permissions = new SessionPermissions();
    const sessionDirectory = resolve("mounted-directory");

    permissions.grantDirectories([
        { action: "enable", access: "read", path: sessionDirectory },
        { action: "enable", access: "write", path: sessionDirectory }
    ]);

    expect(permissions.hasPending()).toBe(false);
    expect(permissions.grants().directories).toEqual({
        read: {
            allow: [sessionDirectory],
            deny: []
        },
        write: {
            allow: [sessionDirectory],
            deny: []
        }
    });
});

test("grants selected paths once and honors access granularity", () => {
    const permissions = new SessionPermissions();
    const sessionDirectory = resolve("mounted-directory");

    permissions.grantDirectories([
        { action: "enable", access: "read", path: sessionDirectory },
        { action: "enable", access: "read", path: sessionDirectory }
    ]);

    expect(permissions.grants().directories.read.allow).toEqual([
        sessionDirectory
    ]);
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
    expect(permissions.grants()).toEqual({
        domains: {
            allow: [],
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
    });
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

    expect(permissions.grants()).toEqual({
        domains: {
            allow: ["api.example.com"],
            deny: ["old.example.com"]
        },
        directories: {
            read: {
                allow: [readEnabled],
                deny: [readDisabled]
            },
            write: {
                allow: [writeEnabled],
                deny: [writeDisabled]
            }
        }
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

    expect(permissions.grants()).toEqual({
        domains: {
            allow: ["old.example.com"],
            deny: ["api.example.com"]
        },
        directories: {
            read: {
                allow: [readDisabled],
                deny: [readEnabled]
            },
            write: {
                allow: [writeDisabled],
                deny: [writeEnabled]
            }
        }
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
        expect(permissions.grants().directories.write).toEqual({
            allow: [],
            deny: [path]
        });

        const enable = permissions.begin({
            domains: [],
            directories: [{ action: "enable", access: "write", path: otherCase }]
        });
        permissions.respond(enable.request.id, "approved");
        expect(permissions.grants().directories.write).toEqual({
            allow: [otherCase],
            deny: []
        });
    }
);
