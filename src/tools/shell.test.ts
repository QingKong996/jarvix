import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { ShellTool } from "./shell.ts";
import type { LlmToolCallBlock } from "../llm/types.ts";

const tools: ShellTool[] = [];

afterEach(() => {
    for (const tool of tools.splice(0)) {
        tool.dispose();
    }
});

function call(name: string, arguments_: Record<string, unknown>): LlmToolCallBlock {
    return { type: "toolCall", id: "call-1", name, arguments: arguments_ };
}

test("executes a command and returns its output", async () => {
    const tool = new ShellTool();
    tools.push(tool);
    const command = process.platform === "win32" ? "Write-Output hello" : "printf hello";

    const result = await tool.execute(call("exec_command", {
        command,
        cwd: process.cwd(),
        timeoutMs: 10_000
    }), () => undefined);

    expect(result.isError).toBe(false);
    expect(result.data).toMatchObject({
        kind: "shell.exec_command",
        status: "completed"
    });
    expect(result.data.output).toContain("hello");
});

test("starts Windows PowerShell without relying on PATH", async () => {
    if (process.platform !== "win32") {
        return;
    }
    const path = process.env.Path;
    const upperPath = process.env.PATH;
    process.env.Path = "";
    process.env.PATH = "";
    try {
        const tool = new ShellTool();
        tools.push(tool);
        const result = await tool.execute(call("exec_command", {
            command: "Write-Output pathless",
            cwd: process.cwd(),
            timeoutMs: 10_000
        }), () => undefined);

        expect(result.isError).toBe(false);
        expect(result.data.output).toContain("pathless");
    } finally {
        if (path === undefined) {
            delete process.env.Path;
        } else {
            process.env.Path = path;
        }
        if (upperPath === undefined) {
            delete process.env.PATH;
        } else {
            process.env.PATH = upperPath;
        }
    }
});

test("keeps a timed-out shell addressable through write_stdin", async () => {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-shell-"));
    const script = join(directory, "echo.mjs");
    writeFileSync(script, [
        "process.stdout.write('ready\\n');",
        "process.stdin.setEncoding('utf8');",
        "process.stdin.on('data', (data) => {",
        "  process.stdout.write(`ECHO:${data}`);",
        "  if (data.includes('quit')) process.exit(0);",
        "});",
        "setTimeout(() => process.exit(0), 5_000);"
    ].join("\n"), "utf8");
    const tool = new ShellTool();
    tools.push(tool);
    const command = process.platform === "win32"
        ? `& ${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`
        : `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`;
    const outputs: string[] = [];

    try {
        const started = await tool.execute(call("exec_command", {
            command,
            cwd: directory,
            timeoutMs: 150
        }), (data) => { outputs.push(data.output); });
        const sessionId = /sessionId: ([0-9a-f-]+)/.exec(started.content)?.[1];
        expect(sessionId).toBeTruthy();
        expect(started.content).toMatch(/IMPORTANT: The command has NOT finished\..*$/s);

        const written = await tool.execute(call("write_stdin", {
            sessionId,
            command: "ping"
        }), (data) => { outputs.push(data.output); });

        expect(written.data).toMatchObject({
            kind: "shell.write_stdin",
            sessionId,
            status: "running"
        });
        expect(written.content).toContain("queued");

        await vi.waitFor(async () => {
            const polled = await tool.execute(call("write_stdin", {
                sessionId,
                command: ""
            }), (data) => { outputs.push(data.output); });
            if (polled.data.output.length > 0) {
                outputs.push(polled.data.output);
            }
            expect(outputs.join("")).toContain("ECHO:ping");
        }, { timeout: 5_000 });

        await tool.execute(call("write_stdin", {
            sessionId,
            command: "quit"
        }), () => undefined);
        await vi.waitFor(async () => {
            const polled = await tool.execute(call("write_stdin", {
                sessionId,
                command: ""
            }), () => undefined);
            if (polled.data.status === "completed") {
                return;
            }
            expect(polled.data.status).toBe("running");
        }, { timeout: 5_000 });
    } finally {
        tool.dispose();
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
        rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});
