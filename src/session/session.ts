import type {
    LlmAdapter,
    LlmMessage,
    LlmModelRef,
    LlmUserMessage
} from "../llm/index.ts";
import type { JarvixConfig } from "../protocol/config.ts";
import type { JarvixEvent } from "../protocol/event.ts";
import type { JarvixSession, JarvixSessionMeta } from "../protocol/session.ts";
import { appendSessionMessage } from "./store.ts";

const DEFAULT_MODEL: LlmModelRef = { provider: "deepseek", id: "deepseek-flash" };
const SYSTEM_PROMPT = "Response user in Chinese";
const PERSIST_ATTEMPTS = 2;

export type SessionRuntime = {
    llm: LlmAdapter;
    config: JarvixConfig;
    emit(event: JarvixEvent): void;
};

/** In-memory state for one conversation. */
export class Session {
    readonly meta: JarvixSessionMeta;
    private readonly history: LlmMessage[];
    private readonly pendingPersistence: LlmMessage[] = [];
    private running = false;

    constructor(meta: JarvixSessionMeta, messages: readonly LlmMessage[] = []) {
        this.meta = meta;
        this.history = [...messages];
    }

    async request(question: string, runtime: SessionRuntime): Promise<void> {
        if (this.running) {
            throw new Error(`Session is busy: ${this.meta.id}`);
        }
        this.running = true;

        try {
            const model = runtime.llm.getModel(DEFAULT_MODEL.provider, DEFAULT_MODEL.id);
            if (!model) {
                throw new Error(`Model not found: ${DEFAULT_MODEL.provider}/${DEFAULT_MODEL.id}`);
            }

            const questionMessage: LlmUserMessage = {
                role: "user",
                content: question,
                timestamp: Date.now()
            };
            this.append(questionMessage);

            const stream = runtime.llm.stream({
                model,
                messages: [...this.history],
                systemPrompt: SYSTEM_PROMPT,
                reasoning: "xhigh",
                apiKey: runtime.config.apiKey
            });

            for await (const event of stream) {
                runtime.emit(event);
                if (event.type === "done") {
                    this.append(event.message);
                }
            }
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            runtime.emit({ type: "request.error", error: reason });
            throw error;
        } finally {
            this.running = false;
        }
    }

    snapshot(): JarvixSession {
        return {
            meta: this.meta,
            messages: [...this.history]
        };
    }

    /** Update memory first, then flush the pending write queue in order. */
    private append(message: LlmMessage): void {
        this.history.push(message);
        this.pendingPersistence.push(message);
        this.flushPendingPersistence();
    }

    private flushPendingPersistence(): void {
        while (this.pendingPersistence.length > 0) {
            this.persist(this.pendingPersistence[0]!);
            this.pendingPersistence.shift();
        }
    }

    private persist(message: LlmMessage): void {
        let lastError: unknown;
        for (let attempt = 0; attempt < PERSIST_ATTEMPTS; attempt += 1) {
            try {
                appendSessionMessage(this.meta.id, message);
                return;
            } catch (error) {
                lastError = error;
            }
        }

        const reason = lastError instanceof Error ? lastError.message : String(lastError);
        throw new Error(
            `Failed to persist session ${this.meta.id} after ${PERSIST_ATTEMPTS} attempts: ${reason}`,
            { cause: lastError }
        );
    }
}
