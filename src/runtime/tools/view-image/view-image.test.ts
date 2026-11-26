import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import type { LlmToolCallBlock } from "../../../protocol/llm.ts";
import {
    createPermissionRules,
    mergePermissionRules
} from "../../../core/permissions/rules.ts";
import { createToolSandbox } from "../../../sandbox/tool-sandbox.ts";
import { createDefaultTools } from "../index.ts";
import { toToolResultDetails } from "../view.ts";
import { VIEW_IMAGE_TOOL, ViewImageTool } from "./view-image.ts";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const directories: string[] = [];

afterEach(() => {
    for (const directory of directories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

test("loads an image as pi-ai image content", async () => {
    const directory = workspace();
    const path = join(directory, "pixel.png");
    writeFileSync(path, Buffer.from(PNG_BASE64, "base64"));

    const result = await new ViewImageTool({ defaultCwd: directory }).execute(
        call(VIEW_IMAGE_TOOL, { path: "pixel.png" }),
        observer
    );

    expect(result.isError).toBe(false);
    expect(result.content).toBe("");
    expect(result.images).toEqual([{
        type: "image",
        data: PNG_BASE64,
        mimeType: "image/png"
    }]);
    expect(result.data).toMatchObject({
        kind: "image.view_image",
        path,
        mimeType: "image/png",
        imageUrl: `data:image/png;base64,${PNG_BASE64}`,
        status: "completed"
    });
    expect(toToolResultDetails(result.data)).toMatchObject({
        kind: "image.view_image",
        imageUrl: ""
    });
});

test("rejects invalid image data and sandbox-denied paths", async () => {
    const directory = workspace();
    const deniedPath = join(directory, "pixel.png");
    writeFileSync(join(directory, "notes.txt"), "not an image", "utf8");
    writeFileSync(deniedPath, Buffer.from(PNG_BASE64, "base64"));
    const tool = new ViewImageTool({ defaultCwd: directory });

    const invalid = await tool.execute(
        call(VIEW_IMAGE_TOOL, { path: "notes.txt" }),
        observer
    );
    expect(invalid.isError).toBe(true);
    expect(invalid.images).toBeUndefined();
    expect(invalid.content).toContain("invalid or unsupported image data");

    const permissionRules = mergePermissionRules(
        createPermissionRules("read-only", [directory]),
        {
            domains: {
                allow: [],
                deny: []
            },
            directories: {
                read: {
                    allow: [],
                    deny: [deniedPath]
                },
                write: {
                    allow: [],
                    deny: []
                }
            }
        }
    );
    const sandbox = createToolSandbox({
        permissionRules: () => permissionRules
    });
    const denied = await new ViewImageTool({
        defaultCwd: directory,
        sandbox: sandbox.access
    }).execute(
        call(VIEW_IMAGE_TOOL, { path: deniedPath }),
        observer
    );
    expect(denied.isError).toBe(true);
    expect(denied.content).toContain("blocked by the sandbox policy");
});

test("registers view_image in the default tool set", () => {
    const tools = createDefaultTools();
    try {
        expect(tools.handles(VIEW_IMAGE_TOOL)).toBe(true);
    } finally {
        tools.dispose();
    }
});

const observer = {
    onOutput: () => undefined
};

function call(name: string, arguments_: Record<string, unknown>): LlmToolCallBlock {
    return {
        type: "toolCall",
        id: "call-view-image",
        name,
        arguments: arguments_
    };
}

function workspace(): string {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-view-image-"));
    directories.push(directory);
    return directory;
}
