import { resolve } from "node:path";
import { expect, test, vi } from "vitest";
import type { LlmToolCallBlock } from "../../../llm/types.ts";
import {
    REQUEST_PERMISSION_TOOL_DEFINITIONS,
    RequestPermissionTool
} from "./request-permission.ts";

const directory = resolve("approved-directory");

function call(arguments_: Record<string, unknown>): LlmToolCallBlock {
    return {
        type: "toolCall",
        id: "permission-call",
        name: "request_permission",
        arguments: arguments_
    };
}

test("registers only while sandbox permissions can change", () => {
    const tool = new RequestPermissionTool();

    expect(tool.getRegisteredTools("read-only")).toBe(tool.definitions);
    expect(tool.getRegisteredTools("project-read-write")).toBe(tool.definitions);
    expect(tool.getRegisteredTools("auto-review")).toBe(tool.definitions);
    expect(tool.getRegisteredTools("full-access")).toEqual([]);
});

test("returns structured approved access", async () => {
    const requestPermission = vi.fn(async () => "approved" as const);
    const result = await new RequestPermissionTool().execute(
        call({
            domains: [{ action: "enable", domain: "API.example.com" }],
            directories: [{ action: "enable", access: "write", path: directory }]
        }),
        { onOutput: () => undefined, requestPermission }
    );

    expect(requestPermission).toHaveBeenCalledWith({
        domains: [{ action: "enable", domain: "api.example.com" }],
        directories: [{ action: "enable", access: "write", path: directory }]
    });
    expect(result.isError).toBe(false);
    expect(result.data).toMatchObject({
        kind: "permission.request",
        domains: [{ action: "enable", domain: "api.example.com" }],
        directories: [{ action: "enable", access: "write", path: directory }],
        decision: "approved",
        status: "completed"
    });
    expect(result.content).toContain("Permission changes approved");
    expect(result.content).toContain("Write access enabled");
});

test("allows either permission category to be omitted", async () => {
    const requestPermission = vi.fn(async () => "approved" as const);
    const tool = new RequestPermissionTool();

    await tool.execute(
        call({
            directories: [{ action: "enable", access: "write", path: directory }]
        }),
        { onOutput: () => undefined, requestPermission }
    );
    await tool.execute(
        call({
            domains: [{ action: "enable", domain: "api.example.com" }]
        }),
        { onOutput: () => undefined, requestPermission }
    );

    expect(requestPermission).toHaveBeenNthCalledWith(1, {
        domains: [],
        directories: [{ action: "enable", access: "write", path: directory }]
    });
    expect(requestPermission).toHaveBeenNthCalledWith(2, {
        domains: [{ action: "enable", domain: "api.example.com" }],
        directories: []
    });
});

test("describes both permission categories as optional", () => {
    const parameters = REQUEST_PERMISSION_TOOL_DEFINITIONS[0]!.parameters;

    expect(parameters.required).toBeUndefined();
});

test("rejects a request without any permission changes", async () => {
    const requestPermission = vi.fn();
    const result = await new RequestPermissionTool().execute(
        call({}),
        { onOutput: () => undefined, requestPermission }
    );

    expect(requestPermission).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content).toContain("At least one domain or directory is required");
});

test("returns a cancelled result without granting access", async () => {
    const result = await new RequestPermissionTool().execute(
        call({
            domains: [{ action: "disable", domain: "api.example.com" }],
            directories: [{ action: "disable", access: "read", path: directory }]
        }),
        {
            onOutput: () => undefined,
            requestPermission: async () => "cancelled"
        }
    );

    expect(result.isError).toBe(false);
    expect(result.data).toMatchObject({
        kind: "permission.request",
        decision: "cancelled",
        status: "completed"
    });
    expect(result.content).toContain("No permission changes were applied");
});

test("rejects relative directories before prompting", async () => {
    const requestPermission = vi.fn();
    const result = await new RequestPermissionTool().execute(
        call({
            domains: [],
            directories: [{ action: "enable", access: "read", path: "relative/path" }]
        }),
        { onOutput: () => undefined, requestPermission }
    );

    expect(requestPermission).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content).toContain("absolute path");
});

test("maps enable and disable changes for every sandbox access type", async () => {
    const requestPermission = vi.fn(async () => "approved" as const);
    await new RequestPermissionTool().execute(
        call({
            domains: [
                { action: "enable", domain: "api.example.com" },
                { action: "disable", domain: "old.example.com" }
            ],
            directories: [
                { action: "enable", access: "read", path: directory },
                { action: "disable", access: "read", path: `${directory}-disabled-read` },
                { action: "enable", access: "write", path: `${directory}-write` },
                { action: "disable", access: "write", path: `${directory}-disabled-write` }
            ]
        }),
        { onOutput: () => undefined, requestPermission }
    );

    expect(requestPermission).toHaveBeenCalledWith({
        domains: [
            { action: "enable", domain: "api.example.com" },
            { action: "disable", domain: "old.example.com" }
        ],
        directories: [
            { action: "enable", access: "read", path: directory },
            { action: "disable", access: "read", path: `${directory}-disabled-read` },
            { action: "enable", access: "write", path: `${directory}-write` },
            { action: "disable", access: "write", path: `${directory}-disabled-write` }
        ]
    });
});

test("rejects conflicting actions for the same target", async () => {
    const requestPermission = vi.fn();
    const result = await new RequestPermissionTool().execute(
        call({
            domains: [
                { action: "enable", domain: "api.example.com" },
                { action: "disable", domain: "API.example.com" }
            ],
            directories: []
        }),
        { onOutput: () => undefined, requestPermission }
    );

    expect(requestPermission).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content).toContain("enabled and disabled");
});
