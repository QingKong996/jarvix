import {
    mkdirSync,
    mkdtempSync,
    rmSync,
    writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { AgentInstructions } from "./agent-instructions.ts";
import { SkillCatalog } from "../../skills/skill-catalog.ts";
import { DefaultContextManager } from "./context-manager.ts";
import { environmentContextFor } from "./environment.ts";

test("keeps environment state isolated between context managers", () => {
    const first = new DefaultContextManager(() => "read-only");
    const second = new DefaultContextManager(() => "read-only");
    first.initializeHistory([]);
    second.initializeHistory([]);
    first.ensureEnvironmentContext(["C:\\first"]);
    second.ensureEnvironmentContext(["C:\\second"]);

    expect(first.environmentReminderIfChanged(["C:\\second"])).not.toBeNull();
    expect(second.environmentReminderIfChanged(["C:\\second"])).toBeNull();
});

test("creates the stable environment context only once", () => {
    const manager = new DefaultContextManager(() => "read-only");

    const first = manager.ensureEnvironmentContext(["C:\\first"]);
    const second = manager.ensureEnvironmentContext(["C:\\second"]);

    expect(first).toMatchObject({
        context: "environment",
        environmentKey: JSON.stringify(["read-only", ["C:\\first"]])
    });
    expect(second).toBeNull();
    expect(manager.prepareRequest([], ["C:\\second"]).messages).toEqual([
        expect.objectContaining({
            role: "user",
            context: "system-reminder"
        })
    ]);
});

test("prepares a request with one environment change reminder", () => {
    let permission: "read-only" | "full-access" = "read-only";
    const manager = new DefaultContextManager(() => permission);
    manager.ensureEnvironmentContext(["C:\\workspace"]);
    permission = "full-access";

    expect(manager.environmentReminderIfChanged(["C:\\workspace"]))
        .not.toBeNull();
    expect(manager.prepareRequest([], ["C:\\workspace"]).messages).toEqual([]);
});

test("restores the leading environment context and hides it from persisted history", () => {
    const manager = new DefaultContextManager(() => "read-only");
    const environment = {
        ...environmentContextFor("read-only", ["C:\\workspace"]),
        context: "environment" as const,
        environmentKey: JSON.stringify(["read-only", ["C:\\workspace"]])
    };
    const user = {
        role: "user" as const,
        content: "hello",
        timestamp: 1
    };

    expect(manager.initializeHistory([user, environment])).toEqual([
        environment,
        user
    ]);
    expect(manager.visibleHistory([environment, user])).toEqual([user]);
});

test("appends the hidden goal to the latest request and only adds the finish prompt when continuing", () => {
    const manager = new DefaultContextManager(() => "read-only");
    manager.ensureEnvironmentContext([]);

    const initial = manager.prepareRequest([], [], {
        goal: "Ship feature A"
    });
    expect(initial.messages.at(-1)).toMatchObject({
        role: "system",
        context: "goal"
    });
    expect(initial.messages.at(-1)).toEqual(expect.objectContaining({
        content: expect.stringContaining("<goal>\nShip feature A\n</goal>")
    }));
    expect(initial.systemPrompt).not.toContain("call finish_goal");

    const continuation = manager.prepareRequest([], [], {
        goal: "Ship feature A",
        requireFinishGoal: true
    });
    expect(continuation.systemPrompt).toContain("call finish_goal explicitly");
    expect(continuation.messages.at(-1)).toMatchObject({
        role: "system",
        context: "goal"
    });
    expect(manager.visibleHistory(continuation.messages)).toEqual([]);
});

test("injects the available skill catalog after agent instructions", () => {
    const root = mkdtempSync(join(tmpdir(), "jarvix-context-skills-"));
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
        const manager = new DefaultContextManager(
            () => "read-only",
            undefined,
            new AgentInstructions({ homeDirectory: home }),
            new SkillCatalog({ homeDirectory: home })
        );
        const environment = manager.ensureEnvironmentContext([workspace]);

        const request = manager.prepareRequest(
            environment ? [environment] : [],
            [workspace]
        );

        expect(request.messages[0]).toMatchObject({
            role: "system",
            context: "environment",
            content: expect.stringContaining("project rules")
        });
        expect(request.messages[1]).toMatchObject({
            role: "system",
            context: "skills",
            content: expect.stringContaining("<name>tdd</name>")
        });
        expect(manager.visibleHistory(request.messages)).toEqual([]);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

function writeFile(path: string, content: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
}
