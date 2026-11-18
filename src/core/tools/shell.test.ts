import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import type { SandboxPreflight } from "../permissions/sandbox-launch.ts";
import { createSandboxPolicy } from "../permissions/sandbox.ts";
import { MAX_TOOL_OUTPUT_CHARS } from "./output.ts";
import {
    MAX_STDIN_COMMAND_CHARS,
    ShellTool,
    type ShellSessionExit
} from "./shell.ts";
import type { LlmToolCallBlock } from "../../llm/types.ts";

const tools: ShellTool[] = [];
const readySandboxPreflight: SandboxPreflight = async () => ({
    ready: true,
    warnings: []
});

afterEach(() => {
    for (const tool of tools.splice(0)) {
        tool.dispose();
    }
});

function call(
    name: string,
    arguments_: Record<string, unknown>,
    id = "call-1"
): LlmToolCallBlock {
    return { type: "toolCall", id, name, arguments: arguments_ };
}

test("executes a command and returns its output", async () => {
    const tool = new ShellTool();
    tools.push(tool);
    const command = process.platform === "win32" ? "Write-Output hello" : "printf hello";

    const result = await tool.execute(call("exec_command", {
        command,
        cwd: process.cwd(),
        timeoutMs: 10_000
    }), { onOutput: () => undefined });

    expect(result.isError).toBe(false);
    expect(result.data).toMatchObject({
        kind: "shell.exec_command",
        status: "completed"
    });
    expect(result.data.output).toContain("hello");
});

test("rejects a timeout beyond the Node timer range", async () => {
    const tool = new ShellTool();
    tools.push(tool);

    const result = await tool.execute(call("exec_command", {
        command: "echo should-not-run",
        cwd: process.cwd(),
        timeoutMs: 2_147_483_648
    }), { onOutput: () => undefined });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("timeoutMs");
    expect(result.data).toMatchObject({
        kind: "shell.exec_command",
        status: "failed"
    });
});

test("retains only the tail of oversized command output", async () => {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-shell-output-"));
    const script = join(directory, "large-output.mjs");
    writeFileSync(script, [
        `process.stdout.write('BEGIN\\n' + 'x'.repeat(${MAX_TOOL_OUTPUT_CHARS}) + 'END\\n');`
    ].join("\n"), "utf8");
    const tool = new ShellTool();
    tools.push(tool);
    const command = process.platform === "win32"
        ? `& ${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`
        : `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`;

    try {
        const result = await tool.execute(call("exec_command", {
            command,
            cwd: directory,
            timeoutMs: 10_000
        }), { onOutput: () => undefined });

        expect(result.isError).toBe(false);
        expect(result.data.output.length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_CHARS + 256);
        expect(result.data.output).not.toContain("BEGIN");
        expect(result.data.output).toContain("END");
        expect(result.content).toContain("earlier characters were discarded");
        expect(result.content).toContain("END");
    } finally {
        tool.dispose();
        rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
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
        }), { onOutput: () => undefined });

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
        }), { onOutput: (data) => { outputs.push(data.output); } });
        const sessionId = /sessionId: ([0-9a-f-]+)/.exec(started.content)?.[1];
        expect(sessionId).toBeTruthy();
        expect(started.content).toMatch(/IMPORTANT: The command has NOT finished\..*$/s);

        const written = await tool.execute(call("write_stdin", {
            sessionId,
            command: "ping"
        }), { onOutput: (data) => { outputs.push(data.output); } });

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
            }), { onOutput: (data) => { outputs.push(data.output); } });
            if (polled.data.output.length > 0) {
                outputs.push(polled.data.output);
            }
            expect(outputs.join("")).toContain("ECHO:ping");
        }, { timeout: 5_000 });

        await tool.execute(call("write_stdin", {
            sessionId,
            command: "quit"
        }), { onOutput: () => undefined });
        await vi.waitFor(async () => {
            const polled = await tool.execute(call("write_stdin", {
                sessionId,
                command: ""
            }), { onOutput: () => undefined });
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

test("bounds retained shell sessions and reuses released slots", async () => {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-shell-session-limit-"));
    const script = join(directory, "short-lived.mjs");
    writeFileSync(script, [
        "process.stdout.write('ready\\n');",
        "setTimeout(() => process.exit(0), 300);"
    ].join("\n"), "utf8");
    const tool = new ShellTool({ maxSessions: 2 });
    tools.push(tool);
    const command = process.platform === "win32"
        ? `& ${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`
        : `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`;

    try {
        const sessionIds: string[] = [];
        const exits: Promise<ShellSessionExit>[] = [];
        for (let index = 0; index < 2; index += 1) {
            const started = await tool.execute(call("exec_command", {
                command,
                cwd: directory,
                timeoutMs: 75
            }, `call-limit-${index}`), { onOutput: () => undefined });
            const sessionId = started.task?.id;
            expect(sessionId).toBeTruthy();
            if (!sessionId) {
                throw new Error("Expected a background task.");
            }
            sessionIds.push(sessionId);
            exits.push(new Promise((resolvePromise) => {
                tool.watchSession(sessionId, () => undefined, resolvePromise);
            }));
        }
        await Promise.all(exits);

        const rejected = await tool.execute(call("exec_command", {
            command: "echo should-not-start",
            cwd: directory,
            timeoutMs: 5_000
        }, "call-limit-rejected"), { onOutput: () => undefined });

        expect(rejected.isError).toBe(true);
        expect(rejected.task).toBeUndefined();
        expect(rejected.content).toContain("Shell session limit reached (2");

        for (const sessionId of sessionIds) {
            tool.releaseSession(sessionId);
        }
        const releasedCommand = process.platform === "win32"
            ? "Write-Output slot-released"
            : "printf slot-released";
        const released = await tool.execute(call("exec_command", {
            command: releasedCommand,
            cwd: directory,
            timeoutMs: 5_000
        }), { onOutput: () => undefined });

        expect(released.isError).toBe(false);
        expect(released.data.output).toContain("slot-released");
    } finally {
        tool.dispose();
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
        rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});

test("rejects an oversized write_stdin command before dispatching it", async () => {
    const tool = new ShellTool();
    tools.push(tool);

    const result = await tool.execute(call("write_stdin", {
        sessionId: "missing-session",
        command: "x".repeat(MAX_STDIN_COMMAND_CHARS + 1)
    }), { onOutput: () => undefined });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Invalid arguments for write_stdin");
    expect(result.content).not.toContain("Shell session not found");
});

test("stops accepting stdin input when the pending queue is full", async () => {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-shell-queue-"));
    const script = join(directory, "idle.mjs");
    writeFileSync(script, [
        "process.stdout.write('ready\\n');",
        "setInterval(() => undefined, 1_000);"
    ].join("\n"), "utf8");
    const tool = new ShellTool();
    tools.push(tool);
    const command = process.platform === "win32"
        ? `& ${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`
        : `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`;

    try {
        const started = await tool.execute(call("exec_command", {
            command,
            cwd: directory,
            timeoutMs: 100
        }), { onOutput: () => undefined });
        const sessionId = started.task?.id;
        expect(sessionId).toBeTruthy();
        if (!sessionId) {
            throw new Error("Expected a background task.");
        }
        const payload = "x".repeat(MAX_STDIN_COMMAND_CHARS);

        const first = await tool.execute(call("write_stdin", {
            sessionId,
            command: payload
        }), { onOutput: () => undefined });
        const second = await tool.execute(call("write_stdin", {
            sessionId,
            command: payload
        }), { onOutput: () => undefined });
        const overflow = await tool.execute(call("write_stdin", {
            sessionId,
            command: payload
        }), { onOutput: () => undefined });

        expect(first.content).toContain("queued");
        expect(second.content).toContain("queued");
        expect(overflow.isError).toBe(true);
        expect(overflow.content).toContain("pending input buffer is full");
    } finally {
        tool.dispose();
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
        rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});

test("aborts a running command before timeout and returns its output", async () => {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-shell-abort-"));
    const script = join(directory, "wait.mjs");
    writeFileSync(script, [
        "process.stdout.write('ready\\n');",
        "setTimeout(() => process.exit(0), 10_000);"
    ].join("\n"), "utf8");
    const tool = new ShellTool();
    tools.push(tool);
    const command = process.platform === "win32"
        ? `& ${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`
        : `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`;
    const outputs: string[] = [];
    const controller = new AbortController();

    try {
        const execution = tool.execute(call("exec_command", {
            command,
            cwd: directory,
            timeoutMs: 10_000
        }), {
            onOutput: (data) => {
                outputs.push(data.output);
            }
        }, controller.signal);

        await vi.waitFor(() => {
            expect(outputs.join("")).toContain("ready");
        }, { timeout: 5_000 });

        const startedAt = Date.now();
        controller.abort();
        const result = await execution;

        expect(Date.now() - startedAt).toBeLessThan(2_000);
        expect(result).toMatchObject({
            isError: true,
            data: {
                kind: "shell.exec_command",
                status: "failed"
            }
        });
        expect(result.content).toContain("Command aborted");
        expect(result.data.output).toContain("ready");
    } finally {
        tool.dispose();
        rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});

test("returns sandbox violations from the runner under the invocation id", async () => {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-shell-sandbox-"));
    const runner = join(directory, "fake-sandbox-runner.mjs");
    writeFileSync(runner, [
        "import { readFileSync } from 'node:fs';",
        "const invocation = JSON.parse(readFileSync(process.argv[2], 'utf8'));",
        "process.stdout.write('sandboxed output\\n');",
        "process.send?.({",
        "  type: 'violations',",
        "  commandId: invocation.commandId,",
        "  violations: [{",
        "    line: `blocked for ${invocation.commandId}`,",
        "    timestamp: Date.now()",
        "  }]",
        "});",
        "process.send?.({",
        "  type: 'done',",
        "  commandId: invocation.commandId,",
        "  exitCode: 0",
        "}, () => process.exit(0));",
        "setTimeout(() => process.exit(0), 250).unref();"
    ].join("\n"), "utf8");
    const tool = new ShellTool({
        sandboxPolicy: () => createSandboxPolicy("read-only", [directory]),
        sandboxPreflight: readySandboxPreflight,
        sandboxRunnerPath: runner
    });
    tools.push(tool);

    try {
        const first = await tool.execute(call("exec_command", {
            command: "ignored",
            cwd: directory,
            timeoutMs: 5_000
        }, "call-shell-1"), { onOutput: () => undefined });
        const second = await tool.execute(call("exec_command", {
            command: "ignored",
            cwd: directory,
            timeoutMs: 5_000
        }, "call-shell-2"), { onOutput: () => undefined });

        expect(first.isError).toBe(true);
        expect(first.data).toMatchObject({
            kind: "shell.exec_command",
            status: "failed"
        });
        expect(first.content).toContain("sandboxed output");
        expect(first.content).toContain("<sandbox_violations>");
        expect(first.content).toContain("blocked for call-shell-1");
        expect(second.content).toContain("<sandbox_violations>");

        expect(second.content).toContain("blocked for call-shell-2");
        expect(first.content).not.toContain("call-shell-2");
        expect(second.content).not.toContain("call-shell-1");
    } finally {
        tool.dispose();
        rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});

test("returns only new sandbox violations when a timed-out task exits", async () => {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-shell-sandbox-background-"));
    const runner = join(directory, "fake-sandbox-runner.mjs");
    writeFileSync(runner, [
        "import { readFileSync } from 'node:fs';",
        "const invocation = JSON.parse(readFileSync(process.argv[2], 'utf8'));",
        "const sendViolation = (line) => process.send?.({",
        "  type: 'violations',",
        "  commandId: invocation.commandId,",
        "  violations: [{ line, timestamp: Date.now() }]",
        "});",
        "sendViolation('blocked before timeout');",
        "setTimeout(() => {",
        "  sendViolation('blocked after timeout');",
        "  process.send?.({",
        "    type: 'done',",
        "    commandId: invocation.commandId,",
        "    exitCode: 0",
        "  }, () => process.exit(0));",
        "}, 1_500);"
    ].join("\n"), "utf8");
    const tool = new ShellTool({
        sandboxPolicy: () => createSandboxPolicy("read-only", [directory]),
        sandboxPreflight: readySandboxPreflight,
        sandboxRunnerPath: runner
    });
    tools.push(tool);

    try {
        const started = await tool.execute(call("exec_command", {
            command: "ignored",
            cwd: directory,
            timeoutMs: 1_000
        }, "call-background-violations"), { onOutput: () => undefined });
        const sessionId = started.task?.id;
        expect(sessionId).toBeTruthy();
        if (!sessionId) {
            throw new Error("Expected a background task.");
        }
        expect(started.content).toContain("blocked before timeout");
        expect(started.content).not.toContain("blocked after timeout");

        const exit = await new Promise<ShellSessionExit>((resolvePromise) => {
            tool.watchSession(sessionId, () => undefined, resolvePromise);
        });

        expect(exit.intercepted).toBe(true);
        expect(exit.violations).toEqual(["blocked after timeout"]);
    } finally {
        tool.dispose();
        rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});

test("returns a setup error before starting a sandboxed command", async () => {
    const tool = new ShellTool({
        sandboxPolicy: () => createSandboxPolicy("project-read-write", [process.cwd()]),
        sandboxPreflight: async () => ({
            ready: false,
            errors: ["Sandbox user is not provisioned (user=false, cred=false)."],
            warnings: []
        })
    });
    tools.push(tool);

    const result = await tool.execute(call("exec_command", {
        command: "echo ok",
        cwd: process.cwd(),
        timeoutMs: 5_000
    }), { onOutput: () => undefined });

    expect(result.isError).toBe(true);
    expect(result.data).toMatchObject({
        kind: "shell.exec_command",
        command: "echo ok",
        status: "failed"
    });
    expect(result.content).toContain("was not executed");
    expect(result.content).toContain("not a permission-mode denial");
    expect(result.content).toContain("Install or repair the Windows sandbox from Jarvix");
});
