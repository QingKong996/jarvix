import type { LlmSystemMessage } from "../../../protocol/llm.ts";

export type PendingPrompt = {
    type: "prompt";
    id: string;
    text: string;
};

export type PendingSystemMessage = {
    type: "system";
    message: LlmSystemMessage;
};

type PendingTurnMessage =
    | PendingPrompt
    | PendingSystemMessage;

export type PendingMessageHandlers = {
    insertPrompt(pending: PendingPrompt): void;
    insertSystem(pending: PendingSystemMessage): void;
};

export class PendingMessageQueue {
    private readonly messages: PendingTurnMessage[] = [];

    get length(): number {
        return this.messages.length;
    }

    addPrompt(id: string, text: string): void {
        this.messages.push({ type: "prompt", id, text });
    }

    addSystemMessage(message: LlmSystemMessage): void {
        this.messages.push({ type: "system", message });
    }

    discardPrompts(): void {
        for (let index = this.messages.length - 1; index >= 0; index -= 1) {
            if (this.messages[index]?.type === "prompt") {
                this.messages.splice(index, 1);
            }
        }
    }

    flush(handlers: PendingMessageHandlers): boolean {
        let insertedPrompt = false;
        while (this.messages.length > 0) {
            const pending = this.messages.shift()!;
            if (pending.type === "prompt") {
                insertedPrompt = true;
                handlers.insertPrompt(pending);
            } else {
                handlers.insertSystem(pending);
            }
        }
        return insertedPrompt;
    }

    flushSystemMessages(
        handlers: PendingMessageHandlers,
        blocked: boolean
    ): void {
        if (blocked) {
            return;
        }
        while (true) {
            const pending = this.messages[0];
            if (!pending || pending.type === "prompt") {
                return;
            }
            this.messages.shift();
            handlers.insertSystem(pending);
        }
    }
}
