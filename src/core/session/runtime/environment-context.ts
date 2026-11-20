import type { LlmMessage, LlmSystemMessage } from "../../../llm/types.ts";
import type { PermissionMode } from "../../../protocol/permission.ts";
import {
    environmentContextFor,
    environmentKeyFor,
    environmentReminderFor,
    isEnvironmentContextMessage
} from "./environment.ts";

export class SessionEnvironmentContext {
    private readonly permission: () => PermissionMode;
    private contextMessage: LlmSystemMessage | null = null;
    private key: string | null = null;

    constructor(permission: () => PermissionMode) {
        this.permission = permission;
    }

    initialize(messages: readonly LlmMessage[]): LlmMessage[] {
        const history = [...messages];
        const context = history.find(isEnvironmentContextMessage);
        if (!context) {
            return history;
        }
        this.contextMessage = context;
        this.key = context.environmentKey ?? null;
        return [
            context,
            ...history.filter((message) => message !== context)
        ];
    }

    ensure(workingDirectories?: readonly string[]): LlmSystemMessage | null {
        if (this.contextMessage) {
            return null;
        }
        const directories = workingDirectories ?? [];
        const key = environmentKeyFor(this.permission(), directories);
        const message: LlmSystemMessage = {
            ...environmentContextFor(this.permission(), directories),
            context: "environment",
            environmentKey: key
        };
        this.contextMessage = message;
        this.key = key;
        return message;
    }

    messagesFor(
        history: readonly LlmMessage[],
        workingDirectories?: readonly string[]
    ): LlmMessage[] {
        const directories = workingDirectories ?? [];
        const key = environmentKeyFor(this.permission(), directories);
        if (!this.contextMessage) {
            return [
                {
                    ...environmentContextFor(this.permission(), directories),
                    context: "environment",
                    environmentKey: key
                },
                ...history
            ];
        }
        const messages = [...history];
        if (this.key !== key) {
            messages.push(
                environmentReminderFor(this.permission(), directories).persisted
            );
        }
        return messages;
    }

    reminderIfChanged(
        workingDirectories?: readonly string[]
    ): ReturnType<typeof environmentReminderFor> | null {
        const directories = workingDirectories ?? [];
        const key = environmentKeyFor(this.permission(), directories);
        if (key === this.key) {
            return null;
        }
        this.key = key;
        return environmentReminderFor(this.permission(), directories);
    }
}
