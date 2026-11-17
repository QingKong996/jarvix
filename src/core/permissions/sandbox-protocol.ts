import type {
    SandboxRuntimeConfig,
    WindowsBinShell
} from "@anthropic-ai/sandbox-runtime";

export type SandboxRunnerInvocation = {
    config: SandboxRuntimeConfig;
    command: string;
    commandId: string;
    cwd: string;
    binShell?: string | WindowsBinShell;
};

export type SandboxRunnerViolation = {
    line: string;
    command?: string;
    timestamp: number;
};

export type SandboxRunnerMessage =
    | {
        type: "violations";
        commandId: string;
        violations: SandboxRunnerViolation[];
    }
    | {
        type: "done";
        commandId: string;
        exitCode: number | null;
    };

export function isSandboxRunnerMessage(message: unknown): message is SandboxRunnerMessage {
    if (typeof message !== "object" || message === null) {
        return false;
    }
    const value = message as Record<string, unknown>;
    if (typeof value.commandId !== "string") {
        return false;
    }
    if (value.type === "done") {
        return value.exitCode === null || typeof value.exitCode === "number";
    }
    if (value.type !== "violations" || !Array.isArray(value.violations)) {
        return false;
    }
    return value.violations.every((violation) =>
        typeof violation === "object"
        && violation !== null
        && typeof (violation as Record<string, unknown>).line === "string"
    );
}
