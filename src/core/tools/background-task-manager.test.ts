import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import type { LlmToolCallBlock } from "../../llm/types.ts";
import { BackgroundTaskManager } from "./background-task-manager.ts";
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
        expect(events).toContainEqual(expect.objectContaining({
            type: "tool.end",
            toolCallId: "call-1",
            toolName: "exec_command",
            endReason: "terminated",
            isError: false,
            data: expect.objectContaining({
                kind: "shell.exec_command",
                status: "completed"
            })
        }));

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

function call(name: string, arguments_: Record<string, unknown>): LlmToolCallBlock {
    return { type: "toolCall", id: "call-1", name, arguments: arguments_ };
}
