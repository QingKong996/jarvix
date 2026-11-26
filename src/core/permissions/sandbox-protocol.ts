import type {
    SandboxRuntimeConfig,
    WindowsBinShell
} from "@anthropic-ai/sandbox-runtime";

export type SandboxRunnerLaunch = {
    command: string;
    args: string[];
    env: NodeJS.ProcessEnv;
};

export type SandboxRunnerRequest =
    | {
        type: "prepare";
        requestId: string;
        config: SandboxRuntimeConfig;
        command: string;
        commandId: string;
        cwd: string;
        binShell?: string | WindowsBinShell;
    }
    | {
        type: "complete";
        requestId: string;
        commandId: string;
    }
    | {
        type: "shutdown";
        requestId: string;
    };

export type SandboxRunnerViolation = {
    line: string;
    command?: string;
    timestamp: number;
};

export type SandboxRunnerMessage =
    | {
        type: "prepared";
        requestId: string;
        commandId: string;
        launch: SandboxRunnerLaunch;
    }
    | {
        type: "completed";
        requestId: string;
        commandId: string;
        violations: SandboxRunnerViolation[];
    }
    | {
        type: "violations";
        commandId: string;
        violations: SandboxRunnerViolation[];
    }
    | {
        type: "error";
        requestId: string;
        message: string;
    }
    | {
        type: "shutdown";
        requestId: string;
    };

export function isSandboxRunnerMessage(message: unknown): message is SandboxRunnerMessage {
    if (typeof message !== "object" || message === null) {
        return false;
    }
    const value = message as Record<string, unknown>;
    if (value.type === "prepared") {
        return (
            typeof value.requestId === "string"
            && typeof value.commandId === "string"
            && isLaunch(value.launch)
        );
    }
    if (value.type === "completed") {
        return (
            typeof value.requestId === "string"
            && typeof value.commandId === "string"
            && isViolations(value.violations)
        );
    }
    if (value.type === "violations") {
        return (
            typeof value.commandId === "string"
            && isViolations(value.violations)
        );
    }
    if (value.type === "error") {
        return (
            typeof value.requestId === "string"
            && typeof value.message === "string"
        );
    }
    if (value.type === "shutdown") {
        return typeof value.requestId === "string";
    }
    return false;
}

function isLaunch(value: unknown): value is SandboxRunnerLaunch {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const launch = value as Record<string, unknown>;
    return (
        typeof launch.command === "string"
        && Array.isArray(launch.args)
        && launch.args.every((argument) => typeof argument === "string")
        && typeof launch.env === "object"
        && launch.env !== null
    );
}

function isViolations(value: unknown): value is SandboxRunnerViolation[] {
    return Array.isArray(value) && value.every((violation) =>
        typeof violation === "object"
        && violation !== null
        && typeof (violation as Record<string, unknown>).line === "string"
    );
}
