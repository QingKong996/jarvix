import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import type { LlmToolCallBlock } from "../../../protocol/llm.ts";

const taskkillChildren = vi.hoisted(
    () => [] as Array<{ killed: boolean }>
);
const syncTaskkillStall = vi.hoisted(() => ({ enabled: false }));

vi.mock("node:child_process", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:child_process")>();
    return {
        ...actual,
        spawn: ((...args: Parameters<typeof actual.spawn>) => {
            const command = String(args[0]);
            if (command.toLowerCase().endsWith("taskkill.exe")) {
                const killer = new EventEmitter() as EventEmitter & {
                    killed: boolean;
                    kill(): boolean;
                };
                killer.killed = false;
                killer.kill = () => {
                    killer.killed = true;
                    return true;
                };
                taskkillChildren.push(killer);
                return killer as unknown as ReturnType<typeof actual.spawn>;
            }
            return actual.spawn(...args);
        }) as typeof actual.spawn,
        spawnSync: ((...args: Parameters<typeof actual.spawnSync>) => {
            const command = String(args[0]);
            if (
                syncTaskkillStall.enabled &&
                command.toLowerCase().endsWith("taskkill.exe")
            ) {
                const options = args[2] as { timeout?: number } | undefined;
                return actual.spawnSync(
                    process.execPath,
                    ["-e", "setTimeout(() => {}, 10_000)"],
                    {
                        stdio: "ignore",
                        windowsHide: true,
                        timeout: options?.timeout
                    }
                );
            }
            return actual.spawnSync(...args);
        }) as typeof actual.spawnSync
    };
});

const { ShellTool } = await import("./shell.ts");

function call(arguments_: Record<string, unknown>): LlmToolCallBlock {
    return {
        type: "toolCall",
        id: "call-taskkill-timeout",
        name: "exec_command",
        arguments: arguments_
    };
}

test.skipIf(process.platform !== "win32")(
    "bounds an aborted command when the taskkill helper never closes",
    async () => {
        const directory = mkdtempSync(join(tmpdir(), "jarvix-shell-taskkill-"));
        const script = join(directory, "wait.mjs");
        writeFileSync(
            script,
            [
                "process.stdout.write(`child-ready:${process.pid}\\n`);",
                "setTimeout(() => process.exit(0), 10_000);"
            ].join("\n"),
            "utf8"
        );
        const tool = new ShellTool();
        const outputs: string[] = [];
        const controller = new AbortController();
        let childPid: number | undefined;

        try {
            const execution = tool.execute(call({
                command: `& ${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`,
                cwd: directory,
                timeoutMs: 10_000
            }), {
                onOutput: ({ output }) => outputs.push(output)
            }, controller.signal);
            await vi.waitFor(() => {
                expect(outputs.join("")).toContain("child-ready:");
            }, { timeout: 5_000 });
            childPid = Number(/child-ready:(\d+)/.exec(outputs.join(""))?.[1]);
            expect(childPid).toBeGreaterThan(0);

            const startedAt = Date.now();
            controller.abort();
            const result = await execution;

            expect(Date.now() - startedAt).toBeLessThan(4_000);
            expect(result.content).toContain("Command aborted");
            expect(taskkillChildren).toHaveLength(1);
            expect(taskkillChildren[0]?.killed).toBe(true);
        } finally {
            tool.dispose();
            if (childPid !== undefined) {
                try {
                    process.kill(childPid, "SIGKILL");
                } catch {
                    // The child may already have exited.
                }
            }
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
            rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        }
    },
    10_000
);

test.skipIf(process.platform !== "win32")(
    "bounds synchronous cleanup when taskkill times out across sessions",
    async () => {
        const directory = mkdtempSync(join(tmpdir(), "jarvix-shell-dispose-"));
        const tool = new ShellTool();

        try {
            for (let index = 0; index < 2; index += 1) {
                const result = await tool.execute(call({
                    command: "Start-Sleep -Seconds 10",
                    cwd: directory,
                    timeoutMs: 50
                }), { onOutput: () => undefined });
                expect(result.endReason).toBe("background");
            }

            syncTaskkillStall.enabled = true;
            const startedAt = Date.now();
            tool.dispose();
            expect(Date.now() - startedAt).toBeLessThan(3_500);
        } finally {
            syncTaskkillStall.enabled = false;
            tool.dispose();
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
            rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        }
    },
    15_000
);
