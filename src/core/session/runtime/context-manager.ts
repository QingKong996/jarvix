import type {
    LlmMessage,
    LlmSystemMessage,
    LlmToolDefinition,
    LlmUserMessage
} from "../../../protocol/llm.ts";
import type { JarvixContextUsage } from "../../../protocol/context-usage.ts";
import type { PermissionMode } from "../../../protocol/permission.ts";
import { estimateContextUsage } from "./context-usage.ts";
import {
    SYSTEM_PROMPT,
    environmentContextFor,
    environmentKeyFor,
    environmentReminderFor,
    isEnvironmentContextMessage
} from "./environment.ts";

export type EnvironmentReminder = {
    persisted: LlmUserMessage;
    display: LlmSystemMessage;
};

export type ContextRequest = {
    systemPrompt: string;
    messages: LlmMessage[];
};

export type ContextManagerUsageInput = {
    contextWindow: number;
    history: readonly LlmMessage[];
    workingDirectories?: readonly string[];
    tools?: readonly LlmToolDefinition[];
};

export interface ContextManager {
    readonly systemPrompt: string;
    initializeHistory(messages: readonly LlmMessage[]): LlmMessage[];
    ensureEnvironmentContext(
        workingDirectories?: readonly string[]
    ): LlmSystemMessage | null;
    environmentReminderIfChanged(
        workingDirectories?: readonly string[]
    ): EnvironmentReminder | null;
    prepareRequest(
        history: readonly LlmMessage[],
        workingDirectories?: readonly string[]
    ): ContextRequest;
    visibleHistory(messages: readonly LlmMessage[]): LlmMessage[];
    estimateUsage(input: ContextManagerUsageInput): JarvixContextUsage;
}

export type ContextManagerFactory = (permission: () => PermissionMode) => ContextManager;

export class DefaultContextManager implements ContextManager {
    readonly systemPrompt: string;
    private readonly permission: () => PermissionMode;
    private contextMessage: LlmSystemMessage | null = null;
    private environmentKey: string | null = null;

    constructor(
        permission: () => PermissionMode,
        systemPrompt = SYSTEM_PROMPT
    ) {
        this.permission = permission;
        this.systemPrompt = systemPrompt;
    }

    initializeHistory(messages: readonly LlmMessage[]): LlmMessage[] {
        const history = [...messages];
        const context = history.find(isEnvironmentContextMessage);
        if (!context) {
            return history;
        }
        this.contextMessage = context;
        this.environmentKey = context.environmentKey ?? null;
        return [
            context,
            ...history.filter((message) => message !== context)
        ];
    }

    ensureEnvironmentContext(
        workingDirectories: readonly string[] = []
    ): LlmSystemMessage | null {
        if (this.contextMessage) {
            return null;
        }
        const key = environmentKeyFor(this.permission(), workingDirectories);
        const message: LlmSystemMessage = {
            ...environmentContextFor(this.permission(), workingDirectories),
            context: "environment",
            environmentKey: key
        };
        this.contextMessage = message;
        this.environmentKey = key;
        return message;
    }

    environmentReminderIfChanged(
        workingDirectories: readonly string[] = []
    ): EnvironmentReminder | null {
        const key = environmentKeyFor(this.permission(), workingDirectories);
        if (key === this.environmentKey) {
            return null;
        }
        this.environmentKey = key;
        return environmentReminderFor(this.permission(), workingDirectories);
    }

    prepareRequest(
        history: readonly LlmMessage[],
        workingDirectories: readonly string[] = []
    ): ContextRequest {
        const key = environmentKeyFor(this.permission(), workingDirectories);
        let messages: LlmMessage[];
        if (!this.contextMessage) {
            messages = [
                {
                    ...environmentContextFor(this.permission(), workingDirectories),
                    context: "environment",
                    environmentKey: key
                },
                ...history
            ];
        } else {
            messages = [...history];
            if (this.environmentKey !== key) {
                messages.push(
                    environmentReminderFor(this.permission(), workingDirectories).persisted
                );
            }
        }
        return {
            systemPrompt: this.systemPrompt,
            messages
        };
    }

    visibleHistory(messages: readonly LlmMessage[]): LlmMessage[] {
        return messages.filter((message) => !isEnvironmentContextMessage(message));
    }

    estimateUsage(input: ContextManagerUsageInput): JarvixContextUsage {
        return estimateContextUsage({
            contextWindow: input.contextWindow,
            systemPrompt: this.systemPrompt,
            messages: this.prepareRequest(input.history, input.workingDirectories).messages,
            tools: input.tools
        });
    }
}

export function createDefaultContextManager(
    permission: () => PermissionMode
): ContextManager {
    return new DefaultContextManager(permission);
}
