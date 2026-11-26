import { randomUUID } from "node:crypto";
import {
    spawn,
    type ChildProcessWithoutNullStreams,
    type StdioOptions
} from "node:child_process";
import { parseWindowsSandboxError } from "@anthropic-ai/sandbox-runtime";
import {
    type SandboxLaunch
} from "../../../core/permissions/sandbox-launch.ts";
import { shellLaunch } from "./launch.ts";
import {
    addSandboxViolations,
    appendOutput,
    type ShellSession
} from "./session.ts";

type StartShellSessionOptions = {
    command: string;
    cwd: string;
    listener: (chunk: string) => void;
    sandboxed: SandboxLaunch | null;
    sharedSlotHeld: boolean;
    register(session: ShellSession): void;
    onFinished(session: ShellSession): void;
};

export function startShellSession(options: StartShellSessionOptions): ShellSession {
    const {
        command,
        cwd,
        listener,
        sandboxed,
        sharedSlotHeld,
        register,
        onFinished
    } = options;
    const launch = sandboxed?.launch ?? shellLaunch(command);
    let child: ChildProcessWithoutNullStreams;
    try {
        const stdio: StdioOptions = ["pipe", "pipe", "pipe"];
        child = spawn(launch.command, launch.args, {
            cwd,
            env: sandboxed?.launch.env ?? process.env,
            stdio,
            windowsHide: true,
            detached: process.platform !== "win32"
        }) as ChildProcessWithoutNullStreams;
    } catch (error) {
        sandboxed?.cleanup();
        throw error;
    }

    let resolveDone!: () => void;
    const done = new Promise<void>((resolvePromise) => {
        resolveDone = resolvePromise;
    });
    const session: ShellSession = {
        id: randomUUID(),
        command,
        cwd,
        child,
        output: "",
        truncatedCharacters: 0,
        truncationNoticeSent: false,
        broadcastOffset: 0,
        readOffset: 0,
        commandQueue: [],
        commandQueueChars: 0,
        writing: false,
        retained: false,
        sharedSlotHeld,
        ended: false,
        exitCode: null,
        error: null,
        sandbox: sandboxed
            ? {
                commandId: sandboxed.commandId,
                violations: [],
                seenViolations: new Set(),
                omittedViolations: 0,
                intercepted: false
            }
            : null,
        done,
        finish: () => {
            if (session.ended) {
                return;
            }
            session.ended = true;
            session.listener = null;
            session.commandQueue.length = 0;
            session.commandQueueChars = 0;
            session.writing = false;
            const exitListener = session.exitListener;
            session.exitListener = null;
            session.cleanup?.();
            session.cleanup = undefined;
            onFinished(session);
            resolveDone();
            exitListener?.();
        },
        cleanup: sandboxed?.cleanup,
        listener,
        exitListener: null
    };
    register(session);

    const sandbox = session.sandbox;
    const unsubscribeViolations = sandboxed && sandbox
        ? sandboxed.onViolations((violations) => {
            addSandboxViolations(sandbox, violations);
        })
        : undefined;
    let ending = false;
    let sandboxCompletion: Promise<void> | null = null;

    const finishSession = (): void => {
        if (ending) {
            return;
        }
        ending = true;
        unsubscribeViolations?.();
        session.finish();
    };
    const completeSandbox = (): Promise<void> => {
        if (!sandboxed || !sandbox || sandboxCompletion) {
            return sandboxCompletion ?? Promise.resolve();
        }
        sandboxCompletion = sandboxed.complete()
            .then((violations) => {
                addSandboxViolations(sandbox, violations);
            })
            .catch((error: unknown) => {
                session.error ??= `Sandbox cleanup failed: ${errorMessage(error)}`;
            });
        return sandboxCompletion;
    };
    const finishAfterSandbox = (): void => {
        if (ending) {
            return;
        }
        void completeSandbox().finally(finishSession);
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => appendOutput(session, chunk));
    child.stderr.on("data", (chunk: string) => appendOutput(session, chunk));
    child.once("error", (error) => {
        session.error = error.message;
        finishAfterSandbox();
    });
    child.once("close", (code) => {
        session.exitCode = code;
        if (process.platform === "win32" && code === 16) {
            const launchError = parseWindowsSandboxError(session.output);
            if (launchError?.code === "mapped_drive_cwd") {
                session.error = [
                    "The Windows sandbox could not start with this working directory.",
                    "The sandbox account may not be able to access it, or it may be on a mapped network drive.",
                    "Use a local working directory inside the session's readable roots."
                ].join(" ");
            }
        }
        finishAfterSandbox();
    });
    child.stdin.on("error", (error) => {
        session.error = error.message;
        finishAfterSandbox();
    });
    return session;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
