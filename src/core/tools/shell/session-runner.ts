import { randomUUID } from "node:crypto";
import {
    spawn,
    type ChildProcessWithoutNullStreams,
    type StdioOptions
} from "node:child_process";
import {
    type SandboxLaunch
} from "../../permissions/sandbox-launch.ts";
import { isSandboxRunnerMessage } from "../../permissions/sandbox-protocol.ts";
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
        const stdio: StdioOptions = sandboxed
            ? ["pipe", "pipe", "pipe", "ipc"]
            : ["pipe", "pipe", "pipe"];
        child = spawn(launch.command, launch.args, {
            cwd,
            env: sandboxed?.env ?? process.env,
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
                intercepted: false,
                done: false
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

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => appendOutput(session, chunk));
    child.stderr.on("data", (chunk: string) => appendOutput(session, chunk));
    let closeReceived = false;
    let completionTimer: NodeJS.Timeout | undefined;
    const finishWhenReady = (): void => {
        if (!closeReceived || (session.sandbox !== null && !session.sandbox.done)) {
            return;
        }
        if (completionTimer !== undefined) {
            clearTimeout(completionTimer);
            completionTimer = undefined;
        }
        session.finish();
    };
    child.on("message", (message: unknown) => {
        const sandbox = session.sandbox;
        if (
            !sandboxed ||
            !sandbox ||
            !isSandboxRunnerMessage(message) ||
            message.commandId !== sandboxed.commandId
        ) {
            return;
        }
        if (message.type === "violations") {
            addSandboxViolations(sandbox, message.violations);
            return;
        }
        sandbox.done = true;
        session.exitCode = message.exitCode;
        finishWhenReady();
    });
    child.once("error", (error) => {
        session.error = error.message;
        if (completionTimer !== undefined) {
            clearTimeout(completionTimer);
        }
        session.finish();
    });
    child.once("close", (code) => {
        closeReceived = true;
        session.exitCode = code;
        if (session.sandbox !== null) {
            completionTimer = setTimeout(() => {
                completionTimer = undefined;
                if (session.sandbox !== null) {
                    session.sandbox.done = true;
                }
                finishWhenReady();
            }, 75);
        }
        finishWhenReady();
    });
    child.stdin.on("error", (error) => {
        session.error = error.message;
        if (completionTimer !== undefined) {
            clearTimeout(completionTimer);
        }
        session.finish();
    });
    return session;
}
