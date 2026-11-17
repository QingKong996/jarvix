import { expect, test, vi } from "vitest";
import type {
    SandboxInstallResult,
    SandboxPreflightResult
} from "../../core/permissions/sandbox-launch.ts";
import { SandboxSetupService } from "./sandbox-setup.ts";

test("resumes a pending preflight after the renderer installs the sandbox", async () => {
    let ready = false;
    const notifyRequired = vi.fn();
    const preflight = vi.fn(async (): Promise<SandboxPreflightResult> => (
        ready
            ? { ready: true, warnings: [] }
            : { ready: false, errors: ["Sandbox user is not provisioned."], warnings: [] }
    ));
    const install = vi.fn(async (): Promise<SandboxInstallResult> => {
        ready = true;
        return { status: "installed" };
    });
    const service = new SandboxSetupService({
        preflight,
        profileReady: async () => true,
        install,
        notifyRequired,
        windowAvailable: () => true
    });

    const first = service.preflight();
    const second = service.preflight();
    await tick();

    expect(notifyRequired).toHaveBeenCalledTimes(1);
    await expect(service.install()).resolves.toEqual({ status: "installed" });
    await expect(first).resolves.toEqual({ ready: true, warnings: [] });
    await expect(second).resolves.toEqual({ ready: true, warnings: [] });
    expect(install).toHaveBeenCalledTimes(1);
});

test("finishes when preflight becomes ready before the installer promise settles", async () => {
    vi.useFakeTimers();
    try {
        let checks = 0;
        const preflight = vi.fn(async (): Promise<SandboxPreflightResult> => {
            checks += 1;
            return checks === 1
                ? {
                    ready: false,
                    errors: ["Sandbox user is not provisioned."],
                    warnings: []
                }
                : { ready: true, warnings: [] };
        });
        const install = vi.fn<() => Promise<SandboxInstallResult>>(
            () => new Promise(() => undefined)
        );
        const profileReady = vi.fn()
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(false)
            .mockResolvedValue(true);
        const service = new SandboxSetupService({
            preflight,
            profileReady,
            install,
            notifyRequired: () => undefined,
            windowAvailable: () => true,
            installStatusPollMs: 10
        });

        const pending = service.preflight();
        await Promise.resolve();
        await Promise.resolve();
        const installing = service.install();
        await vi.advanceTimersByTimeAsync(10);
        await vi.advanceTimersByTimeAsync(10);

        await expect(installing).resolves.toEqual({ status: "installed" });
        await expect(pending).resolves.toEqual({ ready: true, warnings: [] });
        expect(install).toHaveBeenCalledTimes(1);
        expect(preflight).toHaveBeenCalledTimes(3);
        expect(profileReady).toHaveBeenCalledTimes(3);
    } finally {
        vi.useRealTimers();
    }
});

test("waits for a new profile grant when one was already current", async () => {
    vi.useFakeTimers();
    try {
        const preflight = vi.fn(async (): Promise<SandboxPreflightResult> => ({
            ready: true,
            warnings: []
        }));
        const install = vi.fn<() => Promise<SandboxInstallResult>>(
            () => new Promise(() => undefined)
        );
        const profileReady = vi.fn()
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(false)
            .mockResolvedValue(true);
        const service = new SandboxSetupService({
            preflight,
            profileReady,
            install,
            notifyRequired: () => undefined,
            windowAvailable: () => true,
            installStatusPollMs: 10
        });

        let settled = false;
        const installing = service.install();
        void installing.then(() => {
            settled = true;
        });

        await vi.advanceTimersByTimeAsync(10);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(10);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(10);

        await expect(installing).resolves.toEqual({ status: "installed" });
        expect(profileReady).toHaveBeenCalledTimes(4);
    } finally {
        vi.useRealTimers();
    }
});

test("rejects a pending preflight when the renderer dismisses setup", async () => {
    const preflight = vi.fn(async (): Promise<SandboxPreflightResult> => ({
        ready: false,
        errors: ["Sandbox user is not provisioned."],
        warnings: []
    }));
    const service = new SandboxSetupService({
        preflight,
        notifyRequired: () => undefined,
        windowAvailable: () => true
    });

    const pending = service.preflight();
    await tick();
    service.dismiss();

    await expect(pending).resolves.toEqual({
        ready: false,
        errors: ["Windows sandbox installation was not approved."],
        warnings: []
    });
});

function tick(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}
