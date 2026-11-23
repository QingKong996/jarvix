import type { LlmMessage, LlmUserMessage } from "../../../protocol/llm.ts";
import { ensureMessageRecordId } from "../persistence/records.ts";
import {
    appendSessionCompaction,
    appendSessionMessage
} from "../persistence/store.ts";

const PERSIST_ATTEMPTS = 2;

type PendingPersistence =
    | {
        type: "message";
        message: LlmMessage;
    } | {
        type: "compact";
        message: LlmUserMessage;
        messageIds: readonly string[];
    };

export class SessionPersistenceQueue {
    private readonly sessionId: string;
    private readonly pending: PendingPersistence[] = [];

    constructor(sessionId: string) {
        this.sessionId = sessionId;
    }

    get pendingCount(): number {
        return this.pending.length;
    }

    enqueue(message: LlmMessage): void {
        ensureMessageRecordId(message);
        this.pending.push({ type: "message", message });
        this.flush();
    }

    enqueueCompaction(message: LlmUserMessage, compacted: readonly LlmMessage[]): void {
        ensureMessageRecordId(message);
        const messageIds = compacted.map(ensureMessageRecordId);
        this.pending.push({ type: "compact", message, messageIds });
        this.flush();
    }

    private flush(): void {
        while (this.pending.length > 0) {
            this.persist(this.pending[0]!);
            this.pending.shift();
        }
    }

    private persist(pending: PendingPersistence): void {
        let lastError: unknown;
        for (let attempt = 0; attempt < PERSIST_ATTEMPTS; attempt += 1) {
            try {
                if (pending.type === "message") {
                    appendSessionMessage(this.sessionId, pending.message);
                } else {
                    appendSessionCompaction(
                        this.sessionId,
                        pending.message,
                        pending.messageIds
                    );
                }
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
