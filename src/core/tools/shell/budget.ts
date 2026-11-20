import { DEFAULT_MAX_APP_SHELL_SESSIONS } from "./limits.ts";

/** Shares a bounded number of active or retained shell sessions across conversations. */
export class ShellSessionBudget {
    readonly capacity: number;
    private readonly reclaimable = new Map<string, () => void>();
    private used = 0;

    constructor(capacity = DEFAULT_MAX_APP_SHELL_SESSIONS) {
        if (!Number.isSafeInteger(capacity) || capacity < 1) {
            throw new RangeError("capacity must be a positive safe integer.");
        }
        this.capacity = capacity;
    }

    get inUse(): number {
        return this.used;
    }

    tryAcquire(): boolean {
        while (this.used >= this.capacity) {
            const oldest = this.reclaimable.entries().next().value;
            if (!oldest) {
                return false;
            }
            this.reclaimable.delete(oldest[0]);
            oldest[1]();
        }
        this.used += 1;
        return true;
    }

    release(): void {
        if (this.used > 0) {
            this.used -= 1;
        }
    }

    /** Register a completed unread session that may free its slot under pressure. */
    registerReclaimable(sessionId: string, reclaim: () => void): void {
        this.reclaimable.set(sessionId, reclaim);
    }

    unregisterReclaimable(sessionId: string): void {
        this.reclaimable.delete(sessionId);
    }
}
