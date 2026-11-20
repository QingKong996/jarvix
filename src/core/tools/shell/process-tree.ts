import {
    spawn,
    spawnSync,
    type ChildProcessWithoutNullStreams
} from "node:child_process";
import { join } from "node:path";

export const STOP_GRACE_MS = 2_000;
export const STOP_FORCE_MS = 2_000;
const TASKKILL_TIMEOUT_MS = 2_000;

type ProcessTreeTarget = {
    child: Pick<ChildProcessWithoutNullStreams, "pid" | "kill">;
};

export async function terminateProcessTree(session: ProcessTreeTarget): Promise<void> {
    const pid = session.child.pid;
    if (pid === undefined) {
        session.child.kill();
        return;
    }

    if (process.platform === "win32") {
        await taskkill(pid, session);
        return;
    }

    try {
        process.kill(-pid, "SIGTERM");
    } catch {
        session.child.kill();
    }
}

export async function forceTerminateProcessTree(session: ProcessTreeTarget): Promise<void> {
    const pid = session.child.pid;
    if (pid === undefined) {
        session.child.kill("SIGKILL");
        return;
    }

    if (process.platform === "win32") {
        await taskkill(pid, session);
        return;
    }

    try {
        process.kill(-pid, "SIGKILL");
    } catch {
        session.child.kill("SIGKILL");
    }
}

export function terminateProcessTreeSync(
    session: ProcessTreeTarget,
    deadline = Date.now() + STOP_GRACE_MS
): void {
    const pid = session.child.pid;
    if (pid === undefined) {
        session.child.kill("SIGKILL");
        return;
    }

    if (process.platform === "win32") {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
            session.child.kill("SIGKILL");
            return;
        }
        const result = spawnSync(
            windowsTaskkillPath(),
            taskkillArguments(pid),
            {
                stdio: "ignore",
                windowsHide: true,
                timeout: remaining
            }
        );
        if (result.error || result.status !== 0) {
            session.child.kill("SIGKILL");
        }
        return;
    }

    try {
        process.kill(-pid, "SIGKILL");
    } catch {
        session.child.kill("SIGKILL");
    }
}

async function taskkill(pid: number, session: ProcessTreeTarget): Promise<void> {
    await new Promise<void>((resolvePromise) => {
        let killer: ReturnType<typeof spawn> | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let settled = false;
        const finish = (fallback: boolean): void => {
            if (settled) {
                return;
            }
            settled = true;
            if (timer !== undefined) {
                clearTimeout(timer);
            }
            if (fallback) {
                try {
                    killer?.kill();
                } catch {
                    // The termination helper may have already exited.
                }
                try {
                    session.child.kill();
                } catch {
                    // The shell may already be gone.
                }
            }
            resolvePromise();
        };

        try {
            killer = spawn(
                windowsTaskkillPath(),
                taskkillArguments(pid),
                { stdio: "ignore", windowsHide: true }
            );
        } catch {
            finish(true);
            return;
        }
        timer = setTimeout(() => finish(true), TASKKILL_TIMEOUT_MS);
        killer.once("error", () => finish(true));
        killer.once("close", () => finish(false));
    });
}

function windowsTaskkillPath(): string {
    const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows";
    return join(systemRoot, "System32", "taskkill.exe");
}

function taskkillArguments(pid: number): string[] {
    return ["/PID", String(pid), "/T", "/F"];
}
