import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import type { LlmToolCallBlock } from "../llm/types.ts";
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

function call(name: string, arguments_: Record<string, unknown>): LlmToolCallBlock {
    return { type: "toolCall", id: "call-1", name, arguments: arguments_ };
}
