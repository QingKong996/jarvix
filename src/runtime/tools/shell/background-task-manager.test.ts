import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import type { LlmToolCallBlock } from "../../../protocol/llm.ts";
import type { SandboxReadiness } from "../../../core/execution/sandbox.ts";
import { createPermissionRules } from "../../../core/permissions/rules.ts";
import { createToolSandbox } from "../../../sandbox/tool-sandbox.ts";
import {
    BackgroundTaskManager,
    MAX_BACKGROUND_SUBSCRIPTIONS
} from "./background-task-manager.ts";
import { writeFakeSandboxRunner } from "../../../sandbox/fake-runner.ts";
import { ShellSessionBudget, ShellTool } from "./shell.ts";
import type { ToolBackgroundEnd, ToolTaskEvent } from "../types.ts";

const readySandboxPreflight = async (): Promise<SandboxReadiness> => ({
    ready: true,
    warnings: []
});

test("keeps streaming a timed-out task and isolates it from other managers", async () => {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-background-"));
    const script = join(directory, "task.mjs");
    writeFileSync(script, [
        "process.stdout.write('start\\n');",
        "setTimeout(() => process.stdout.write('later\\n', () => process.exit(0)), 400);"
    ].join("\n"), "utf8");
    const command = process.platform === "win32"
        ? `& ${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`
        : `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`;
    const first = new BackgroundTaskManager();
    const second = new BackgroundTaskManager();
    const outputAfterReturn: string[] = [];
    const completed: { tool: string; result: ToolBackgroundEnd }[] = [];
    const taskEvents: ToolTaskEvent[] = [];
    let returned = false;
    const collectOutput = (data: { output: string }): void => {
        if (returned) {
            outputAfterReturn.push(data.output);
        }
    };

    try {
        expect(first.hasActiveWork()).toBe(false);
        const started = await first.execute(call("exec_command", {
            command,
            cwd: directory,
            timeoutMs: 50
        }), {
            onOutput: collectOutput,
            onBackgroundEnd: (result) => {
                completed.push({ tool: "exec_command", result });
            },
            onTaskEvent: (event) => {
                taskEvents.push(event);
            }
        });
        returned = true;

        expect(started.data.status).toBe("timed_out");
        expect(started.endReason).toBe("background");
        expect(first.hasActiveWork()).toBe(true);
        const taskId = started.task?.id;
        expect(taskId).toBeTruthy();
        const polled = await first.execute(call("write_stdin", {
            sessionId: taskId,
            command: ""
        }), {
            onOutput: collectOutput,
            onBackgroundEnd: (result) => {
                completed.push({ tool: "write_stdin", result });
            },
            onTaskEvent: (event) => {
                taskEvents.push(event);
            }
        });
        expect(polled.task?.id).toBe(taskId);

        await vi.waitFor(() => {
            expect(taskEvents).toContainEqual(expect.objectContaining({
                type: "backgroundTask.output",
                taskId,
                output: expect.stringContaining("later"),
                truncatedCharacters: expect.any(Number)
            }));
            expect(taskEvents).toContainEqual(expect.objectContaining({
                type: "backgroundTask.end",
                task: expect.objectContaining({
                    id: taskId,
                    status: "completed",
                    unreadCharacters: expect.any(Number)
                })
            }));
            expect(outputAfterReturn.join("")).not.toContain("later");
            expect(completed.map(({ tool }) => tool).sort()).toEqual(["exec_command", "write_stdin"]);
            for (const { result } of completed) {
                expect(result).toMatchObject({
                    taskId,
                    unreadOutput: expect.stringContaining("later"),
                    data: { status: "completed" },
                    isError: false
                });
            }
        }, { timeout: 5_000 });

        const drained = await first.execute(call("write_stdin", {
            sessionId: taskId,
            command: ""
        }), {
            onOutput: () => undefined,
            onTaskEvent: (event) => {
                taskEvents.push(event);
            }
        });
        expect(drained.data).toMatchObject({
            kind: "shell.write_stdin",
            sessionId: taskId,
            status: "completed"
        });
        expect(drained.data.output).toContain("later");
        expect(taskEvents).toContainEqual(expect.objectContaining({
            type: "backgroundTask.consume",
            task: expect.objectContaining({
                id: taskId,
                status: "completed",
                unreadCharacters: 0
            })
        }));
        expect(first.hasActiveWork()).toBe(false);

        const forgotten = await first.execute(call("write_stdin", {
            sessionId: taskId,
            command: ""
        }), { onOutput: () => undefined });
        expect(forgotten.isError).toBe(true);
        expect(forgotten.data.output).toContain("Shell session not found");

        const isolated = await second.execute(call("write_stdin", {
            sessionId: taskId,
            command: ""
        }), { onOutput: () => undefined });
        expect(isolated.isError).toBe(true);
        expect(isolated.data.output).toContain("Shell session not found");
    } finally {
        first.dispose();
        second.dispose();
        await removeTemporaryDirectory(directory);
    }
});

test("stops active tasks and returns their end events", async () => {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-background-stop-"));
    const script = join(directory, "running.mjs");
    writeFileSync(script, [
        "process.stdout.write('ready\\n');",
        "setInterval(() => process.stdout.write('tick\\n'), 50);"
    ].join("\n"), "utf8");
    const command = process.platform === "win32"
        ? `& ${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`
        : `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`;
    const manager = new BackgroundTaskManager();

    try {
        const started = await manager.execute(call("exec_command", {
            command,
            cwd: directory,
            timeoutMs: 50
        }), { onOutput: () => undefined });
        const taskId = started.task?.id;
        expect(taskId).toBeTruthy();

        const events = await manager.stop();
        expect(events).toContainEqual(expect.objectContaining({
            type: "backgroundTask.end",
            task: expect.objectContaining({
                id: taskId,
                status: expect.not.stringMatching(/^running$/)
            })
        }));
        const taskEnd = events.find(
            (event) => event.type === "backgroundTask.end" && event.task.id === taskId
        );
        const toolEnd = events.find(
            (event) => event.type === "tool.end" && event.toolCallId === "call-1"
        );
        if (taskEnd?.type !== "backgroundTask.end" || toolEnd?.type !== "tool.end") {
            throw new Error("Expected background task end events.");
        }
        expect(toolEnd).toMatchObject({
            type: "tool.end",
            toolCallId: "call-1",
            toolName: "exec_command",
            endReason: "terminated",
            isError: taskEnd.task.status === "failed",
            data: expect.objectContaining({
                kind: "shell.exec_command",
                status: taskEnd.task.status
            })
        });

        const afterStop = await manager.execute(call("write_stdin", {
            sessionId: taskId,
            command: ""
        }), { onOutput: () => undefined });
        expect(afterStop.isError).toBe(true);
        expect(afterStop.content).toContain("Shell session not found");
    } finally {
        manager.dispose();
        await removeTemporaryDirectory(directory);
    }
}, 15_000);

test("bounds subscriptions accumulated by polling a long-running task", async () => {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-background-subscriptions-"));
    const script = join(directory, "running.mjs");
    writeFileSync(script, "setTimeout(() => process.exit(0), 2_000);", "utf8");
    const command = process.platform === "win32"
        ? `& ${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`
        : `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`;
    const manager = new BackgroundTaskManager();
    const completed: string[] = [];

    try {
        const started = await manager.execute(call("exec_command", {
            command,
            cwd: directory,
            timeoutMs: 50
        }), {
            onOutput: () => undefined,
            onBackgroundEnd: () => {
                completed.push("start");
            }
        });
        const taskId = started.task?.id;
        expect(taskId).toBeTruthy();

        for (let index = 0; index < MAX_BACKGROUND_SUBSCRIPTIONS + 8; index += 1) {
            const toolCallId = `poll-${index}`;
            await manager.execute(
                call("write_stdin", { sessionId: taskId, command: "" }, toolCallId),
                {
                    onOutput: () => undefined,
                    onBackgroundEnd: () => {
                        completed.push(toolCallId);
                    }
                }
            );
        }

        await vi.waitFor(() => {
            expect(completed).toHaveLength(MAX_BACKGROUND_SUBSCRIPTIONS);
        }, { timeout: 5_000 });
        expect(completed).toEqual(
            Array.from(
                { length: MAX_BACKGROUND_SUBSCRIPTIONS },
                (_, index) => `poll-${index + 8}`
            )
        );
        expect(manager.hasActiveWork()).toBe(false);
    } finally {
        manager.dispose();
        await removeTemporaryDirectory(directory);
    }
}, 20_000);

test("evicts only the oldest completed unread task when the shared budget is full", async () => {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-background-retention-"));
    const completedScript = join(directory, "completed.mjs");
    const runningScript = join(directory, "running.mjs");
    writeFileSync(completedScript, [
        "process.stdout.write(`start:${process.argv[2]}\\n`);",
        "setTimeout(() => {",
        "  process.stdout.write(`later:${process.argv[2]}\\n`, () => process.exit(0));",
        "}, 250);"
    ].join("\n"), "utf8");
    writeFileSync(runningScript, [
        "process.stdout.write('third-start\\n');",
        "setInterval(() => undefined, 1_000);"
    ].join("\n"), "utf8");
    const nodeCommand = (script: string, ...args: string[]): string => {
        const command = [
            JSON.stringify(process.execPath),
            JSON.stringify(script),
            ...args.map((argument) => JSON.stringify(argument))
        ].join(" ");
        return process.platform === "win32" ? `& ${command}` : command;
    };
    const budget = new ShellSessionBudget(2);
    const first = new BackgroundTaskManager(new ShellTool({ sharedBudget: budget }));
    const second = new BackgroundTaskManager(new ShellTool({ sharedBudget: budget }));
    const third = new BackgroundTaskManager(new ShellTool({ sharedBudget: budget }));
    const firstEvents: ToolTaskEvent[] = [];
    const secondEvents: ToolTaskEvent[] = [];

    const startCompletedTask = async (
        manager: BackgroundTaskManager,
        label: string,
        events: ToolTaskEvent[],
        callId: string
    ): Promise<string> => {
        const started = await manager.execute(call("exec_command", {
            command: nodeCommand(completedScript, label),
            cwd: directory,
            timeoutMs: 50
        }, callId), {
            onOutput: () => undefined,
            onTaskEvent: (event) => {
                events.push(event);
            }
        });
        const taskId = started.task?.id;
        expect(taskId).toBeTruthy();
        if (!taskId) {
            throw new Error("Expected a background task.");
        }
        await vi.waitFor(() => {
            const end = events.find((event): event is Extract<
                ToolTaskEvent,
                { type: "backgroundTask.end" }
            > => event.type === "backgroundTask.end" && event.task.id === taskId);
            expect(end?.task.status).toBe("completed");
            expect(end?.task.unreadCharacters).toBeGreaterThan(0);
        }, { timeout: 5_000 });
        return taskId;
    };

    try {
        const firstId = await startCompletedTask(
            first,
            "first",
            firstEvents,
            "call-retention-first"
        );
        const secondId = await startCompletedTask(
            second,
            "second",
            secondEvents,
            "call-retention-second"
        );
        expect(budget.inUse).toBe(2);

        const thirdStarted = await third.execute(call("exec_command", {
            command: nodeCommand(runningScript),
            cwd: directory,
            timeoutMs: 50
        }, "call-retention-third"), { onOutput: () => undefined });

        expect(thirdStarted.isError).toBe(false);
        expect(thirdStarted.data.status).toBe("timed_out");
        expect(thirdStarted.task?.id).toBeTruthy();
        expect(firstEvents).toContainEqual(expect.objectContaining({
            type: "backgroundTask.discard",
            task: expect.objectContaining({ id: firstId })
        }));
        expect(secondEvents).not.toContainEqual(expect.objectContaining({
            type: "backgroundTask.discard"
        }));
        expect(budget.inUse).toBe(2);

        const forgotten = await first.execute(call("write_stdin", {
            sessionId: firstId,
            command: ""
        }), { onOutput: () => undefined });
        expect(forgotten.isError).toBe(true);
        expect(forgotten.content).toContain("Shell session not found");

        const retained = await second.execute(call("write_stdin", {
            sessionId: secondId,
            command: ""
        }), { onOutput: () => undefined });
        expect(retained.data).toMatchObject({
            kind: "shell.write_stdin",
            sessionId: secondId,
            status: "completed"
        });
        expect(retained.data.output).toContain("later:second");
        expect(budget.inUse).toBe(1);
    } finally {
        first.dispose();
        second.dispose();
        third.dispose();
        await removeTemporaryDirectory(directory);
    }
}, 15_000);

test("keeps a timed-out task failed without repeating reported violations", async () => {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-background-sandbox-"));
    const runner = writeFakeSandboxRunner(directory, {
        launch: {
            command: process.execPath,
            args: ["-e", "setTimeout(() => process.exit(0), 2_000)"]
        },
        immediateViolations: ["blocked before timeout"],
        delayedViolations: [{
            delayMs: 1_500,
            line: "blocked after timeout"
        }]
    });
    const manager = new BackgroundTaskManager(new ShellTool({
        sandbox: createToolSandbox({
            permissionRules: () => createPermissionRules("read-only", [directory])
        }, {
            preflight: readySandboxPreflight,
            runnerPath: runner
        }).command
    }));
    const completed: ToolBackgroundEnd[] = [];

    try {
        const started = await manager.execute(call("exec_command", {
            command: "ignored",
            cwd: directory,
            timeoutMs: 1_000
        }), {
            onOutput: () => undefined,
            onBackgroundEnd: (result) => {
                completed.push(result);
            }
        });
        expect(started.data.status).toBe("failed");
        expect(started.data.output).toContain("blocked before timeout");

        await vi.waitFor(() => {
            expect(completed).toHaveLength(1);
        }, { timeout: 5_000 });
        const result = completed[0]!;
        expect(result.isError).toBe(true);
        expect(result.data.status).toBe("failed");
        expect(result.data.output.match(/blocked before timeout/g)).toHaveLength(1);
    } finally {
        manager.dispose();
        await removeTemporaryDirectory(directory);
    }
});

async function removeTemporaryDirectory(directory: string): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (true) {
        try {
            rmSync(directory, { recursive: true, force: true });
            return;
        } catch (error) {
            if (!isRetryableDirectoryRemovalError(error) || Date.now() >= deadline) {
                throw error;
            }
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
        }
    }
}

function isRetryableDirectoryRemovalError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EBUSY" || code === "ENOTEMPTY" || code === "EPERM";
}

function call(
    name: string,
    arguments_: Record<string, unknown>,
    id = "call-1"
): LlmToolCallBlock {
    return { type: "toolCall", id, name, arguments: arguments_ };
}
