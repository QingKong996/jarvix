import {
    mkdirSync,
    mkdtempSync,
    rmSync,
    writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";
import type { LlmToolCallBlock } from "../../../protocol/llm.ts";
import {
    AgentInstructions,
    agentInstructionPathsForToolCall,
    agentInstructionsMessage
} from "./agent-instructions.ts";

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

test("loads global and project instructions once in stable order", () => {
    const root = tempRoot();
    const home = join(root, "home");
    const workspace = join(root, "workspace");
    const globalPath = join(home, ".jarvix", "AGENTS.md");
    const projectPath = join(workspace, "AGENTS.md");
    writeAgents(globalPath, "global rules");
    writeAgents(projectPath, "project rules");
    writeAgents(join(workspace, "nested", "AGENTS.md"), "nested rules");

    const instructions = new AgentInstructions({ homeDirectory: home });
    const first = instructions.staticInstructions([workspace]);

    expect(first.indexOf("global rules")).toBeLessThan(first.indexOf("project rules"));
    expect(first).toContain(`scope="global" path="${escapePath(globalPath)}"`);
    expect(first).toContain(`scope="project" path="${escapePath(projectPath)}"`);
    expect(first).not.toContain("nested rules");

    const before = instructions.snapshot([workspace]);
    writeAgents(globalPath, "changed global rules");
    expect(instructions.staticInstructions([workspace])).toBe(first);
    const after = instructions.snapshot([workspace]);
    expect(after.content).toContain("changed global rules");
    expect(after.fingerprint).not.toBe(before.fingerprint);
});

test("discovers nested and outside instructions once", () => {
    const root = tempRoot();
    const home = join(root, "home");
    const workspace = join(root, "workspace");
    const packages = join(workspace, "packages");
    const app = join(packages, "app");
    const outside = join(root, "outside");
    writeAgents(join(workspace, "AGENTS.md"), "project rules");
    writeAgents(join(packages, "AGENTS.md"), "packages rules");
    writeAgents(join(app, "AGENTS.md"), "app rules");
    writeAgents(join(outside, "AGENTS.md"), "outside rules");

    const instructions = new AgentInstructions({ homeDirectory: home });
    instructions.staticInstructions([workspace]);

    const nested = instructions.discover(
        [join(app, "src", "file.ts")],
        [workspace]
    );
    expect(nested.map((source) => source.path)).toEqual([
        resolve(join(packages, "AGENTS.md")),
        resolve(join(app, "AGENTS.md"))
    ]);
    expect(nested.map((source) => source.scope)).toEqual(["directory", "directory"]);
    expect(instructions.discover(
        [join(app, "src", "file.ts")],
        [workspace]
    )).toEqual([]);

    const external = instructions.discover(
        [join(outside, "child", "file.ts")],
        [workspace]
    );
    expect(external.map((source) => source.content)).toEqual(["outside rules"]);

    const message = agentInstructionsMessage(nested);
    expect(message).toMatchObject({
        role: "system"
    });
    expect(message.content).toContain("app rules");
});

test("extracts paths from patch, image, and permission tool calls", () => {
    const root = tempRoot();
    const workspace = join(root, "workspace");
    const image = join(workspace, "assets", "image.png");
    const external = join(root, "external");
    const patch = [
        "*** Begin Patch",
        "*** Add File: packages/app/new.ts",
        "+export {};",
        "*** End Patch"
    ].join("\n");

    expect(pathsFor({
        type: "toolCall",
        id: "patch",
        name: "apply_patch",
        arguments: { cwd: workspace, patch }
    }, [workspace])).toEqual([
        resolve(workspace),
        resolve(workspace, "packages", "app", "new.ts")
    ]);
    expect(pathsFor({
        type: "toolCall",
        id: "image",
        name: "view_image",
        arguments: { path: image }
    }, [workspace])).toEqual([resolve(image)]);
    expect(pathsFor({
        type: "toolCall",
        id: "permission",
        name: "request_permission",
        arguments: {
            domains: [],
            directories: [{
                action: "enable",
                access: "read",
                path: external
            }]
        }
    }, [workspace])).toEqual([resolve(external)]);
    expect(pathsFor({
        type: "toolCall",
        id: "shell",
        name: "exec_command",
        arguments: {
            command: `cd packages/app && cat "${join(external, "file.ts")}"`,
            cwd: workspace,
            timeoutMs: 1_000
        }
    }, [workspace])).toEqual([
        resolve(workspace),
        resolve(workspace, "packages", "app"),
        resolve(external, "file.ts")
    ]);
    expect(pathsFor({
        type: "toolCall",
        id: "url",
        name: "exec_command",
        arguments: {
            command: "curl https://example.com/path",
            cwd: workspace,
            timeoutMs: 1_000
        }
    }, [workspace])).toEqual([resolve(workspace)]);
});

function pathsFor(
    call: LlmToolCallBlock,
    workingDirectories: readonly string[]
): string[] {
    return agentInstructionPathsForToolCall(call, workingDirectories);
}

function tempRoot(): string {
    const root = mkdtempSync(join(tmpdir(), "jarvix-agent-instructions-"));
    roots.push(root);
    return root;
}

function writeAgents(path: string, content: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
}

function escapePath(path: string): string {
    return path
        .replaceAll("&", "&amp;")
        .replaceAll("\"", "&quot;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}
