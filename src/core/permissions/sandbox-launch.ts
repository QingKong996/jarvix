import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
    copyFileSync,
    mkdirSync,
    statSync,
    unlinkSync,
    writeFileSync
} from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    checkWindowsDependenciesAsync,
    getWindowsProfileReadStatusAsync,
    installWindowsSandboxAsync,
    resolveSrtWin,
    type SandboxDependencyCheck,
    type SandboxRuntimeConfig,
    type SrtWinSpawn,
    type WindowsBinShell,
    type WindowsProfileGrantStatus
} from "@anthropic-ai/sandbox-runtime";
import type { SandboxRunnerInvocation } from "./sandbox-protocol.ts";
import type { SandboxPolicy } from "./sandbox.ts";

const SANDBOX_REQUIRE = createRequire(import.meta.url);
const WINDOWS_HELPER_DIRECTORY = "JarvixSandbox";
const WINDOWS_HELPER_NAME = "srt-win.exe";

let windowsHelperAccessPrepared = false;

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

export type SandboxPreflightResult =
    | {
        ready: true;
        warnings: readonly string[];
    }
    | {
        ready: false;
        errors: readonly string[];
        warnings: readonly string[];
    };

export type SandboxPreflight = () => Promise<SandboxPreflightResult>;

export type SandboxProfileReadiness = () => Promise<boolean>;

export type SandboxProfileReadinessOptions = {
    platform?: NodeJS.Platform;
    resolveSpawn?: () => SrtWinSpawn;
    checkProfile?: (
        srtWin: SrtWinSpawn
    ) => Promise<Pick<WindowsProfileGrantStatus, "state">>;
};

export type SandboxInstallResult = {
    status: "installed" | "cancelled" | "not-required";
};

export type SandboxPreflightOptions = {
    platform?: NodeJS.Platform;
    resolveSpawn?: () => SrtWinSpawn;
    checkDependencies?: (srtWin: SrtWinSpawn) => Promise<SandboxDependencyCheck>;
};

export type SandboxInstallOptions = {
    platform?: NodeJS.Platform;
    resolveSpawn?: () => SrtWinSpawn;
    install?: (srtWin: SrtWinSpawn) => Promise<{ cancelled?: true }>;
};

/** Build a cached preflight check for the platform sandbox dependencies. */
export function createSandboxPreflight(
    options: SandboxPreflightOptions = {}
): SandboxPreflight {
    const platform = options.platform ?? process.platform;
    const resolveSpawn = options.resolveSpawn ?? defaultWindowsSpawn;
    const checkDependencies = options.checkDependencies ?? ((srtWin) =>
        checkWindowsDependenciesAsync({ srtWin }));
    let windowsReady = false;

    return async () => {
        if (platform !== "win32" || windowsReady) {
            return { ready: true, warnings: [] };
        }

        try {
            const result = await checkDependencies(resolveSpawn());
            if (result.errors.length > 0) {
                return {
                    ready: false,
                    errors: result.errors,
                    warnings: result.warnings
                };
            }
            windowsReady = true;
            return {
                ready: true,
                warnings: result.warnings
            };
        } catch (error) {
            return {
                ready: false,
                errors: [errorMessage(error)],
                warnings: []
            };
        }
    };
}

export const preflightSandbox = createSandboxPreflight();

/** Whether the Windows sandbox profile read grant is complete and current. */
export function createSandboxProfileReadiness(
    options: SandboxProfileReadinessOptions = {}
): SandboxProfileReadiness {
    const platform = options.platform ?? process.platform;
    const resolveSpawn = options.resolveSpawn ?? defaultWindowsSpawn;
    const checkProfile = options.checkProfile ?? ((srtWin) =>
        getWindowsProfileReadStatusAsync({ srtWin }));

    return async () => {
        if (platform !== "win32") {
            return true;
        }
        try {
            const profile = await checkProfile(resolveSpawn());
            return profile.state === "current";
        } catch {
            return false;
        }
    };
}

export const sandboxProfileReady = createSandboxProfileReadiness();

export async function installSandbox(
    options: SandboxInstallOptions = {}
): Promise<SandboxInstallResult> {
    const platform = options.platform ?? process.platform;
    if (platform !== "win32") {
        return { status: "not-required" };
    }

    const resolveSpawn = options.resolveSpawn ?? defaultWindowsSpawn;
    const install = options.install ?? ((srtWin) =>
        installWindowsSandboxAsync({ srtWin }));
    const result = await install(resolveSpawn());
    return {
        status: result.cancelled ? "cancelled" : "installed"
    };
}

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
    const source = unpackedPath(
        join(packageDirectory, "vendor", "srt-win", arch, "srt-win.exe")
    );
    try {
        const directory = join(
            process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
            "Programs",
            WINDOWS_HELPER_DIRECTORY
        );
        const target = join(directory, WINDOWS_HELPER_NAME);
        mkdirSync(directory, { recursive: true });
        if (helperNeedsCopy(source, target)) {
            copyFileSync(source, target);
        }
        prepareWindowsHelperAccess(directory);
        return target;
    } catch {
        return source;
    }
}

function helperNeedsCopy(source: string, target: string): boolean {
    try {
        const sourceStat = statSync(source);
        const targetStat = statSync(target);
        return (
            sourceStat.size !== targetStat.size ||
            sourceStat.mtimeMs > targetStat.mtimeMs
        );
    } catch {
        return true;
    }
}

function prepareWindowsHelperAccess(directory: string): void {
    if (windowsHelperAccessPrepared || process.platform !== "win32") {
        return;
    }
    const computerName = process.env.COMPUTERNAME;
    const group = computerName
        ? `${computerName}\\sandbox-runtime-users`
        : "sandbox-runtime-users";
    try {
        execFileSync(
            "icacls.exe",
            [directory, "/grant", `${group}:(OI)(CI)(RX)`],
            {
                windowsHide: true,
                stdio: "ignore"
            }
        );
        windowsHelperAccessPrepared = true;
    } catch {
        // The sandbox group does not exist until the one-time install completes.
    }
}

function defaultWindowsSpawn(): SrtWinSpawn {
    return resolveSrtWin({
        path: sandboxWindowsExecutable()
    });
}

function unpackedPath(path: string): string {
    return path.replace(/([\\/])app\.asar([\\/])/, "$1app.asar.unpacked$2");
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
