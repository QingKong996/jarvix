import { expect, test } from "vitest";
import type { PermissionRules } from "../core/execution/sandbox.ts";
import { createSandboxPolicy } from "./policy.ts";

const rules: PermissionRules = {
    domains: {
        allow: ["api.example.com"],
        deny: ["old.example.com"]
    },
    directories: {
        read: {
            allow: ["/read"],
            deny: ["/read-denied"]
        },
        write: {
            allow: ["/write"],
            deny: ["/write-denied"]
        }
    }
};

test("maps effective permission rules to sandbox restrictions", () => {
    expect(createSandboxPolicy(rules)).toEqual({
        filesystem: {
            denyRead: [{ path: "/read-denied", literal: true }],
            allowRead: [{ path: "/read", literal: true }],
            allowWrite: [{ path: "/write", literal: true }],
            denyWrite: [{ path: "/write-denied", literal: true }]
        },
        network: {
            allowedDomains: ["api.example.com"],
            deniedDomains: ["old.example.com"]
        }
    });
});

test("full access bypasses the sandbox", () => {
    expect(createSandboxPolicy(null)).toBeNull();
});
