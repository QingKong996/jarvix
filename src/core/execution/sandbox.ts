import type { PermissionRules } from "../permissions/rules.ts";

export type { PermissionRules } from "../permissions/rules.ts";

export type SandboxViolation = {
    line: string;
    command?: string;
    timestamp: number;
};

export type SandboxReadiness =
    | {
        ready: true;
        warnings: readonly string[];
    }
    | {
        ready: false;
        errors: readonly string[];
        warnings: readonly string[];
    };

export type PathAccessDecision =
    | {
        allowed: true;
        path: string;
    }
    | {
        allowed: false;
        path: string;
        reason: string;
    };

export type SandboxShell = string | {
    exe: string;
    args: readonly string[];
};

export type SandboxedCommand = {
    commandId: string;
    command: string;
    args: string[];
    env: NodeJS.ProcessEnv;
    onViolations(
        listener: (violations: readonly SandboxViolation[]) => void
    ): () => void;
    complete(): Promise<readonly SandboxViolation[]>;
    cleanup(): void;
    explainExitError?(
        exitCode: number | null,
        output: string
    ): string | null;
};

export type CommandSandbox = {
    readonly active: boolean;
    preflight(): Promise<SandboxReadiness>;
    prepareCommand(input: {
        command: string;
        cwd: string;
        commandId: string;
        binShell?: SandboxShell;
    }): Promise<SandboxedCommand | null>;
    dispose(): void;
};

export type PathAccessGuard = {
    authorizeRead(path: string): PathAccessDecision;
    authorizeWrites(
        paths: readonly string[]
    ): readonly PathAccessDecision[];
};

export type ToolSandbox = {
    readonly active: boolean;
    readonly command: CommandSandbox;
    readonly access: PathAccessGuard;
};

export type ToolSandboxContext = {
    /** Effective session rules; null means the sandbox is disabled. */
    permissionRules: () => PermissionRules | null;
};

export type ToolSandboxFactory = (context: ToolSandboxContext) => ToolSandbox;
