import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import type { LlmToolCallBlock } from "../../llm/types.ts";
import { createSandboxPolicy } from "../permissions/sandbox.ts";
import { BackgroundTaskManager } from "./background-task-manager.ts";
import { ShellTool } from "./shell.ts";
import type { ToolBackgroundEnd, ToolTaskEvent } from "./types.ts";

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
            expect(taskEvents).toContainEqual({
                type: "backgroundTask.output",
                taskId,
                output: expect.stringContaining("later")
            });
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
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
        rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
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
        rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
}, 15_000);

test("keeps a timed-out task failed without repeating reported violations", async () => {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-background-sandbox-"));
    const runner = join(directory, "fake-sandbox-runner.mjs");
    writeFileSync(runner, [
        "import { readFileSync } from 'node:fs';",
        "const invocation = JSON.parse(readFileSync(process.argv[2], 'utf8'));",
        "process.send?.({",
        "  type: 'violations',",
        "  commandId: invocation.commandId,",
        "  violations: [{ line: 'blocked before timeout', timestamp: Date.now() }]",
        "});",
        "setTimeout(() => {",
        "  process.send?.({",
        "    type: 'done',",
        "    commandId: invocation.commandId,",
        "    exitCode: 0",
        "  }, () => process.exit(0));",
        "}, 1_500);"
    ].join("\n"), "utf8");
    const manager = new BackgroundTaskManager(new ShellTool({
        sandboxPolicy: () => createSandboxPolicy("read-only", [directory]),
        sandboxRunnerPath: runner
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
        rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});

function call(name: string, arguments_: Record<string, unknown>): LlmToolCallBlock {
    return { type: "toolCall", id: "call-1", name, arguments: arguments_ };
}
