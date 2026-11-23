import {
    installSandbox,
    preflightSandbox,
    sandboxProfileReady,
    type SandboxInstallResult,
    type SandboxPreflight,
    type SandboxProfileReadiness,
    type SandboxPreflightResult
} from "../../core/permissions/sandbox-launch.ts";
import { type JarvixLogger, noopLogger } from "../../core/logger.ts";
import type { SandboxInstallOutcome, SandboxStatus } from "../../protocol/ipc.ts";

type SandboxSetupServiceOptions = {
    preflight?: SandboxPreflight;
    profileReady?: SandboxProfileReadiness;
    install?: () => Promise<SandboxInstallResult>;
    notifyRequired?: () => void;
    windowAvailable?: () => boolean;
    installStatusPollMs?: number;
    logger?: JarvixLogger;
};

type PendingRequest = {
    promise: Promise<SandboxPreflightResult>;
    resolve: (result: SandboxPreflightResult) => void;
};

type InstallSettlement =
    | { kind: "install"; result: SandboxInstallResult }
    | { kind: "error"; error: unknown };

type ReadinessSettlement =
    | {
        kind: "ready";
        result: Extract<SandboxPreflightResult, { ready: true }>;
    }
    | null;

const DEFAULT_INSTALL_STATUS_POLL_MS = 5_000;

export class SandboxSetupService {
    private readonly preflightSandbox: SandboxPreflight;
    private readonly profileReady: SandboxProfileReadiness;
    private readonly installWindowsSandbox: () => Promise<SandboxInstallResult>;
    private readonly notifyRequired: () => void;
    private readonly windowAvailable: () => boolean;
    private readonly installStatusPollMs: number;
    private readonly logger: JarvixLogger;
    private pending: PendingRequest | null = null;
    private installRequest: Promise<SandboxInstallOutcome> | null = null;

    constructor(options: SandboxSetupServiceOptions = {}) {
        this.preflightSandbox = options.preflight ?? preflightSandbox;
        this.profileReady = options.profileReady ?? sandboxProfileReady;
        this.installWindowsSandbox = options.install ?? installSandbox;
        this.notifyRequired = options.notifyRequired ?? (() => undefined);
        this.windowAvailable = options.windowAvailable ?? (() => true);
        this.installStatusPollMs = options.installStatusPollMs ?? DEFAULT_INSTALL_STATUS_POLL_MS;
        this.logger = options.logger ?? noopLogger;
    }

    async status(): Promise<SandboxStatus> {
        const result = await this.preflightSandbox();
        this.logger.debug("Checked sandbox status", {
            ready: result.ready,
            warningCount: result.warnings.length
        });
        return {
            ready: result.ready,
            warnings: [...result.warnings]
        };
    }

    async preflight(): Promise<SandboxPreflightResult> {
        const current = await this.preflightSandbox();
        if (current.ready) {
            this.logger.debug("Sandbox preflight passed");
            return current;
        }
        if (!this.windowAvailable()) {
            this.logger.warn("Sandbox preflight needs setup but no window is available", {
                errorCount: current.errors.length,
                warningCount: current.warnings.length
            });
            return setupFailure(
                current,
                "The Jarvix window is not available to confirm Windows sandbox setup."
            );
        }
        if (this.pending) {
            this.logger.debug("Reusing pending sandbox setup request");
            return this.pending.promise;
        }

        let resolveRequest!: (result: SandboxPreflightResult) => void;
        const promise = new Promise<SandboxPreflightResult>((resolvePromise) => {
            resolveRequest = resolvePromise;
        });
        this.pending = {
            promise,
            resolve: resolveRequest
        };
        this.notifyRequired();
        this.logger.info("Sandbox setup is required", {
            errorCount: current.errors.length,
            warningCount: current.warnings.length
        });
        return promise;
    }

    dismiss(): void {
        this.logger.warn("Sandbox setup was dismissed");
        this.resolvePending(setupFailure(
            { ready: false, errors: [], warnings: [] },
            "Windows sandbox installation was not approved."
        ));
    }

    async install(): Promise<SandboxInstallOutcome> {
        if (this.installRequest) {
            this.logger.debug("Reusing pending sandbox installation");
            return this.installRequest;
        }

        this.logger.info("Sandbox installation started");
        this.installRequest = this.runInstall().finally(() => {
            this.installRequest = null;
        });
        return this.installRequest;
    }

    private async runInstall(): Promise<SandboxInstallOutcome> {
        const profileReadyAtStart = await this.profileReady().catch(() => false);
        const readiness = new AbortController();
        try {
            const settlement = await Promise.race<InstallSettlement | ReadinessSettlement>([
                this.installWindowsSandbox().then(
                    (result): InstallSettlement => ({ kind: "install", result }),
                    (error): InstallSettlement => ({ kind: "error", error })
                ),
                this.waitForReadiness(readiness.signal, profileReadyAtStart)
            ]);
            if (settlement === null) {
                throw new Error("Sandbox installation status polling stopped unexpectedly.");
            }
            if (settlement.kind === "ready") {
                this.logger.info("Sandbox became ready while installation was running");
                this.resolvePending(settlement.result);
                return { status: "installed" };
            }
            if (settlement.kind === "error") {
                throw settlement.error;
            }

            const result = settlement.result;
            if (result.status === "cancelled") {
                this.logger.warn("Sandbox installation was cancelled");
                this.resolvePending(setupFailure(
                    { ready: false, errors: [], warnings: [] },
                    "Windows sandbox installation was cancelled at the UAC prompt."
                ));
                return { status: "cancelled" };
            }

            const next = await this.preflightSandbox();
            this.resolvePending(next);
            if (!next.ready) {
                this.logger.warn("Sandbox installation finished but preflight still fails", {
                    errors: next.errors
                });
                return {
                    status: "failed",
                    errors: [...next.errors]
                };
            }
            this.logger.info("Sandbox installation completed");
            return { status: "installed" };
        } catch (error) {
            const message = errorMessage(error);
            this.logger.error("Sandbox installation failed", error);
            this.resolvePending(setupFailure(
                { ready: false, errors: [], warnings: [] },
                message
            ));
            return {
                status: "failed",
                errors: [message]
            };
        } finally {
            readiness.abort();
        }
    }

    private async waitForReadiness(
        signal: AbortSignal,
        profileReadyAtStart: boolean
    ): Promise<ReadinessSettlement> {
        let profileWasNotReady = !profileReadyAtStart;
        while (!signal.aborted) {
            await waitFor(this.installStatusPollMs, signal);
            if (signal.aborted) {
                return null;
            }
            const result = await this.preflightSandbox().catch(() => null);
            if (!result?.ready) {
                continue;
            }
            const profileReady = await this.profileReady().catch(() => false);
            if (!profileReady) {
                profileWasNotReady = true;
                continue;
            }
            if (profileWasNotReady) {
                return { kind: "ready", result };
            }
        }
        return null;
    }

    private resolvePending(result: SandboxPreflightResult): void {
        const pending = this.pending;
        this.pending = null;
        pending?.resolve(result);
    }
}

function setupFailure(
    preflight: Extract<SandboxPreflightResult, { ready: false }>,
    message: string
): SandboxPreflightResult {
    return {
        ready: false,
        errors: [message],
        warnings: preflight.warnings
    };
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function waitFor(milliseconds: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        const finish = (): void => {
            clearTimeout(timer);
            signal.removeEventListener("abort", finish);
            resolve();
        };
        const timer = setTimeout(finish, milliseconds);
        signal.addEventListener("abort", finish, { once: true });
    });
}
