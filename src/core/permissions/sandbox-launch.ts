import { randomUUID } from "node:crypto";
import { unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
    SandboxRuntimeConfig,
    WindowsBinShell
} from "@anthropic-ai/sandbox-runtime";
import type { SandboxRunnerInvocation } from "./sandbox-protocol.ts";
import type { SandboxPolicy } from "./sandbox.ts";

const SANDBOX_REQUIRE = createRequire(import.meta.url);

export type SandboxLaunch = {
    launch: {
        command: string;
        args: string[];
    };
    env: NodeJS.ProcessEnv;
    commandId: string;
    cleanup: () => void;
};

export type SandboxLaunchOptions = {
    command: string;
    cwd: string;
    commandId: string;
    policy: SandboxPolicy;
    binShell?: string | WindowsBinShell;
    runnerPath?: string;
};

export function createSandboxLaunch(options: SandboxLaunchOptions): SandboxLaunch {
    const config: SandboxRuntimeConfig = {
        ...options.policy,
        ...(process.platform === "win32"
            ? { windows: { srtWin: { path: sandboxWindowsExecutable() } } }
            : {})
    };
    const invocationPath = join(tmpdir(), `jarvix-sandbox-${randomUUID()}.json`);
    const invocation: SandboxRunnerInvocation = {
        config,
        command: options.command,
        commandId: options.commandId,
        cwd: options.cwd,
        binShell: options.binShell
    };
    writeFileSync(
        invocationPath,
        `${JSON.stringify(invocation)}\n`,
        { encoding: "utf8", mode: 0o600 }
    );
    return {
        launch: {
            command: process.execPath,
            args: [
                options.runnerPath ?? defaultSandboxRunnerPath(),
                invocationPath
            ]
        },
        env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: "1",
            JARVIX_SANDBOX_RUNNER: "1"
        },
        commandId: options.commandId,
        cleanup: () => {
            try {
                unlinkSync(invocationPath);
            } catch {
                // The OS may have already removed the temporary file.
            }
        }
    };
}

function defaultSandboxRunnerPath(): string {
    return fileURLToPath(new URL("./sandbox-runner.js", import.meta.url));
}

function sandboxWindowsExecutable(): string {
    const arch = process.arch === "arm64" ? "arm64" : "x64";
    const packageDirectory = dirname(
        SANDBOX_REQUIRE.resolve("@anthropic-ai/sandbox-runtime/package.json")
    );
    return unpackedPath(
        join(packageDirectory, "vendor", "srt-win", arch, "srt-win.exe")
    );
}

function unpackedPath(path: string): string {
    return path.replace(/([\\/])app\.asar([\\/])/, "$1app.asar.unpacked$2");
}
