import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import type { LlmToolCallBlock } from "../llm/types.ts";
import { BackgroundTaskManager } from "./background-task-manager.ts";
import type { ToolBackgroundEnd } from "./types.ts";

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
        }), collectOutput, undefined, (result) => {
            completed.push({ tool: "exec_command", result });
        });
        returned = true;

        expect(started.data.status).toBe("timed_out");
        expect(started.taskId).toBeTruthy();
        const polled = await first.execute(call("write_stdin", {
            sessionId: started.taskId,
            command: ""
        }), collectOutput, undefined, (result) => {
            completed.push({ tool: "write_stdin", result });
        });
        expect(polled.taskId).toBe(started.taskId);

        await vi.waitFor(() => {
            expect(outputAfterReturn.join("")).toContain("later");
            expect(completed.map(({ tool }) => tool).sort()).toEqual(["exec_command", "write_stdin"]);
            for (const { result } of completed) {
                expect(result).toMatchObject({
                    taskId: started.taskId,
                    unreadOutput: expect.stringContaining("later"),
                    data: { status: "completed" },
                    isError: false
                });
            }
        }, { timeout: 5_000 });

        const drained = await first.execute(call("write_stdin", {
            sessionId: started.taskId,
            command: ""
        }), () => undefined);
        expect(drained.data).toMatchObject({
            kind: "shell.write_stdin",
            sessionId: started.taskId,
            status: "completed"
        });
        expect(drained.data.output).toContain("later");

        const isolated = await second.execute(call("write_stdin", {
            sessionId: started.taskId,
            command: ""
        }), () => undefined);
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
