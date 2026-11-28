import {
    mkdirSync,
    mkdtempSync,
    rmSync,
    writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { AgentInstructions } from "./agent-instructions.ts";
import { SkillCatalog } from "../../skills/skill-catalog.ts";
import { DefaultContextManager } from "./context-manager.ts";
import { ContextSnapshotTracker } from "./context-injection.ts";

const testHome = vi.hoisted(() => ({ path: "" }));

vi.mock("node:os", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:os")>();
    return { ...actual, homedir: () => testHome.path };
});

beforeEach(() => {
    testHome.path = join(
        tmpdir(),
        `jarvix-context-manager-home-${process.pid}`
    );
});

test("exposes skills, environment, and AGENTS.md as snapshot sources", () => {
    const root = mkdtempSync(join(tmpdir(), "jarvix-context-initial-"));
    const home = join(root, "home");
    const workspace = join(root, "workspace");
    writeFile(join(home, ".jarvix", "AGENTS.md"), "global rules");
    writeFile(join(workspace, "AGENTS.md"), "project rules");
    writeFile(join(home, ".agents", "skills", "tdd", "SKILL.md"), [
        "---",
        "name: tdd",
        "description: Test-driven development",
        "---",
        "",
        "# TDD"
    ].join("\n"));

    try {
        const catalog = new SkillCatalog({ homeDirectory: home });
        const discover = vi.spyOn(catalog, "discover");
        const manager = new DefaultContextManager(
            () => "read-only",
            undefined,
            new AgentInstructions({ homeDirectory: home }),
            catalog
        );

        const sources = manager.contextSources([workspace]);
        const context = new ContextSnapshotTracker().initialize(sources);

        expect(context).toHaveLength(3);
        expect(context[0]).toMatchObject({
            declaration: expect.stringContaining("skills"),
            content: expect.stringContaining("<name>tdd</name>")
        });
        expect(context[1]).toMatchObject({
            declaration: expect.stringContaining("environment"),
            content: expect.stringContaining("<environment_context>")
        });
        expect(context[2]).toMatchObject({
            declaration: expect.stringContaining("AGENTS.md"),
            content: expect.stringContaining("project rules")
        });
        expect(discover).toHaveBeenCalledTimes(1);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("prepares requests without assembling context sources", () => {
    const manager = new DefaultContextManager(() => "read-only");
    const user = {
        role: "user" as const,
        content: "hello",
        timestamp: 1
    };

    const request = manager.prepareRequest([user]);

    expect(request.messages).toEqual([user]);
    expect(request.messages[0]).toBe(user);
    expect(manager.contextSources(["C:\\workspace"])).toHaveLength(3);
    expect(manager.prepareRequest([user]).messages)
        .toEqual([user]);
});

test("only changes the system prompt for goal continuation", () => {
    const manager = new DefaultContextManager(() => "read-only");
    const user = {
        role: "user" as const,
        content: "hello",
        timestamp: 1
    };

    const request = manager.prepareRequest([user], {
        requireFinishGoal: true
    });

    expect(request.systemPrompt).toContain("call finish_goal explicitly");
    expect(request.messages).toEqual([user]);
});

test("hides all injected messages from visible history", () => {
    const manager = new DefaultContextManager(() => "read-only");
    const environment = {
        role: "system" as const,
        content: "environment",
        context: "environment" as const,
        timestamp: 1
    };
    const injected = {
        role: "system" as const,
        content: "injected",
        context: "injected" as const,
        timestamp: 2
    };
    const user = {
        role: "user" as const,
        content: "hello",
        timestamp: 3
    };
    const legacyReminder = {
        role: "user" as const,
        content: "legacy reminder",
        context: "system-reminder" as const,
        timestamp: 4
    };

    expect(manager.initializeHistory([
        environment,
        user,
        legacyReminder
    ])).toEqual([user]);
    expect(manager.visibleHistory([
        environment,
        injected,
        user,
        legacyReminder
    ])).toEqual([
        user
    ]);
});

function writeFile(path: string, content: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
}
