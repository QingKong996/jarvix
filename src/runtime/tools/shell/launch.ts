import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SandboxShell } from "../../../core/execution/sandbox.ts";

export type ShellLaunch = {
    command: string;
    args: string[];
};

const WINDOWS_POWERSHELL = findWindowsPowerShell();

export function sandboxBinShell(): SandboxShell | undefined {
    if (process.platform === "win32") {
        return WINDOWS_POWERSHELL
            ? {
                exe: WINDOWS_POWERSHELL,
                args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"]
            }
            : "cmd";
    }
    return process.env.SHELL || undefined;
}

export function shellLaunch(command: string): ShellLaunch {
    if (process.platform === "win32") {
        if (WINDOWS_POWERSHELL) {
            return {
                command: WINDOWS_POWERSHELL,
                args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command]
            };
        }
        const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows";
        return {
            command: process.env.ComSpec ?? join(systemRoot, "System32", "cmd.exe"),
            args: ["/d", "/s", "/c", command]
        };
    }
    return {
        command: process.env.SHELL || "/bin/sh",
        args: ["-lc", command]
    };
}

export function shellDisplayName(): string {
    if (process.platform === "win32") {
        return WINDOWS_POWERSHELL ? "Windows PowerShell" : "cmd.exe";
    }
    return process.env.SHELL || "/bin/sh";
}

function findWindowsPowerShell(): string | undefined {
    if (process.platform !== "win32") {
        return undefined;
    }
    const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows";
    const programFiles = process.env.ProgramFiles;
    const candidates = [
        join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
        programFiles ? join(programFiles, "PowerShell", "7", "pwsh.exe") : undefined
    ];
    return candidates.find((candidate): candidate is string => candidate !== undefined && existsSync(candidate));
}
