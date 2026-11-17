import { expect, test, vi } from "vitest";
import {
    createSandboxPreflight,
    createSandboxProfileReadiness,
    installSandbox
} from "./sandbox-launch.ts";

const srtWin = {
    exe: "srt-win.exe",
    prependArgs: []
};

test("skips dependency checks outside Windows", async () => {
    const checkDependencies = vi.fn(async () => ({
        errors: [],
        warnings: []
    }));
    const preflight = createSandboxPreflight({
        platform: "linux",
        checkDependencies
    });

    await expect(preflight()).resolves.toEqual({
        ready: true,
        warnings: []
    });
    expect(checkDependencies).not.toHaveBeenCalled();
});

test("reports missing Windows dependencies and rechecks after failure", async () => {
    let calls = 0;
    const preflight = createSandboxPreflight({
        platform: "win32",
        resolveSpawn: () => srtWin,
        checkDependencies: async () => {
            calls += 1;
            return calls === 1
                ? {
                    errors: ["Sandbox user is not provisioned."],
                    warnings: ["Installation is required."]
                }
                : {
                    errors: [],
                    warnings: []
                };
        }
    });

    await expect(preflight()).resolves.toEqual({
        ready: false,
        errors: ["Sandbox user is not provisioned."],
        warnings: ["Installation is required."]
    });
    await expect(preflight()).resolves.toEqual({
        ready: true,
        warnings: []
    });
    expect(calls).toBe(2);
});

test("caches a successful Windows dependency check", async () => {
    const checkDependencies = vi.fn(async () => ({
        errors: [],
        warnings: []
    }));
    const preflight = createSandboxPreflight({
        platform: "win32",
        resolveSpawn: () => srtWin,
        checkDependencies
    });

    await preflight();
    await preflight();

    expect(checkDependencies).toHaveBeenCalledTimes(1);
});

test("reports Windows profile readiness only for a current grant", async () => {
    const checkProfile = vi.fn(async () => ({
        state: "current" as const
    }));
    const profileReady = createSandboxProfileReadiness({
        platform: "win32",
        resolveSpawn: () => srtWin,
        checkProfile
    });

    await expect(profileReady()).resolves.toBe(true);
    expect(checkProfile).toHaveBeenCalledWith(srtWin);
});

test("treats pending or failed Windows profile grants as not ready", async () => {
    const incomplete = createSandboxProfileReadiness({
        platform: "win32",
        resolveSpawn: () => srtWin,
        checkProfile: async () => ({
            state: "incomplete"
        })
    });
    const failed = createSandboxProfileReadiness({
        platform: "win32",
        resolveSpawn: () => srtWin,
        checkProfile: async () => {
            throw new Error("profile_operation_in_progress");
        }
    });

    await expect(incomplete()).resolves.toBe(false);
    await expect(failed()).resolves.toBe(false);
});

test("skips Windows profile checks outside Windows", async () => {
    const checkProfile = vi.fn(async () => ({
        state: "none" as const
    }));
    const profileReady = createSandboxProfileReadiness({
        platform: "linux",
        checkProfile
    });

    await expect(profileReady()).resolves.toBe(true);
    expect(checkProfile).not.toHaveBeenCalled();
});

test("turns a missing srt-win binary into a setup result", async () => {
    const checkDependencies = vi.fn(async () => ({
        errors: [],
        warnings: []
    }));
    const preflight = createSandboxPreflight({
        platform: "win32",
        resolveSpawn: () => {
            throw new Error("srt-win.exe not found");
        },
        checkDependencies
    });

    await expect(preflight()).resolves.toEqual({
        ready: false,
        errors: ["srt-win.exe not found"],
        warnings: []
    });
    expect(checkDependencies).not.toHaveBeenCalled();
});

test("skips Windows installation outside Windows", async () => {
    const install = vi.fn(async () => ({}));
    await expect(installSandbox({
        platform: "linux",
        install
    })).resolves.toEqual({
        status: "not-required"
    });
    expect(install).not.toHaveBeenCalled();
});

test("runs the self-elevating Windows installer", async () => {
    const install = vi.fn(async () => ({}));

    await expect(installSandbox({
        platform: "win32",
        resolveSpawn: () => srtWin,
        install
    })).resolves.toEqual({
        status: "installed"
    });
    expect(install).toHaveBeenCalledWith(srtWin);
});

test("reports a cancelled UAC prompt", async () => {
    await expect(installSandbox({
        platform: "win32",
        resolveSpawn: () => srtWin,
        install: async () => ({ cancelled: true })
    })).resolves.toEqual({
        status: "cancelled"
    });
});
