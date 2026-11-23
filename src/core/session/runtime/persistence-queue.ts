import type { LlmMessage } from "../../../protocol/llm.ts";
import { appendSessionMessage } from "../persistence/store.ts";

const PERSIST_ATTEMPTS = 2;

export class SessionPersistenceQueue {
    private readonly sessionId: string;
    private readonly pending: LlmMessage[] = [];

    constructor(sessionId: string) {
        this.sessionId = sessionId;
    }

    get pendingCount(): number {
        return this.pending.length;
    }

    enqueue(message: LlmMessage): void {
        this.pending.push(message);
        this.flush();
    }

    private flush(): void {
        while (this.pending.length > 0) {
            this.persist(this.pending[0]!);
            this.pending.shift();
        }
    }

    private persist(message: LlmMessage): void {
        let lastError: unknown;
        for (let attempt = 0; attempt < PERSIST_ATTEMPTS; attempt += 1) {
            try {
                appendSessionMessage(this.sessionId, message);
                return;
            } catch (error) {
                lastError = error;
            }
        }

        const reason = lastError instanceof Error ? lastError.message : String(lastError);
        throw new Error(
            `Failed to persist session ${this.sessionId} after ${PERSIST_ATTEMPTS} attempts: ${reason}`,
            { cause: lastError }
        );
    }
}
