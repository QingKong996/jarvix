import type { LlmSystemMessage } from "../../../llm/types.ts";

export type PendingPrompt = {
    type: "prompt";
    id: string;
    text: string;
};

export type PendingSystemMessage = {
    type: "system";
    message: LlmSystemMessage;
};

type PendingEnvironmentReminder = {
    type: "environment";
};

type PendingTurnMessage =
    | PendingPrompt
    | PendingSystemMessage
    | PendingEnvironmentReminder;

export type PendingMessageHandlers = {
    insertPrompt(pending: PendingPrompt): void;
    insertEnvironment(): void;
    insertSystem(pending: PendingSystemMessage): void;
};

export class PendingMessageQueue {
    private readonly messages: PendingTurnMessage[] = [];

    get length(): number {
        return this.messages.length;
    }

    hasEnvironmentReminder(): boolean {
        return this.messages.some((pending) => pending.type === "environment");
    }

    addPrompt(id: string, text: string): void {
        this.messages.push({ type: "prompt", id, text });
    }

    addEnvironmentReminder(): void {
        this.messages.push({ type: "environment" });
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
            } else if (pending.type === "environment") {
                handlers.insertEnvironment();
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
            if (pending.type === "environment") {
                handlers.insertEnvironment();
            } else {
                handlers.insertSystem(pending);
            }
        }
    }
}
