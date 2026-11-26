import type {
    LlmMessage,
    LlmSystemMessage,
    LlmToolDefinition,
    LlmUserMessage
} from "../../../protocol/llm.ts";
import type { JarvixContextUsage } from "../../../protocol/context-usage.ts";
import type { PermissionMode } from "../../../protocol/permission.ts";
import {
    AgentInstructions,
    type AgentInstructionSource
} from "./agent-instructions.ts";
import {
    availableSkillsMessage,
    type SkillCatalog
} from "../../skills/skill-catalog.ts";
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

export type ContextRequestOptions = {
    goal?: string;
    requireFinishGoal?: boolean;
};

export type ContextManagerUsageInput = {
    contextWindow: number;
    history: readonly LlmMessage[];
    workingDirectories?: readonly string[];
    tools?: readonly LlmToolDefinition[];
    goal?: string;
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
    discoverAgentInstructions?(
        paths: readonly string[],
        workingDirectories?: readonly string[]
    ): readonly AgentInstructionSource[];
    prepareRequest(
        history: readonly LlmMessage[],
        workingDirectories?: readonly string[],
        options?: ContextRequestOptions
    ): ContextRequest;
    visibleHistory(messages: readonly LlmMessage[]): LlmMessage[];
    estimateUsage(input: ContextManagerUsageInput): JarvixContextUsage;
}

const GOAL_CONTINUATION_PROMPT = [
    "You are continuing an active goal automatically.",
    "Do not stop after an interim response or claim that the goal is complete.",
    "Continue working until the result is ready, then call finish_goal explicitly.",
    "Only finish_goal can end the goal; it starts an independent verification."
].join("\n");

function systemPromptFor(
    base: string,
    options: ContextRequestOptions | undefined
): string {
    return options?.requireFinishGoal
        ? `${base}\n\n${GOAL_CONTINUATION_PROMPT}`
        : base;
}

function goalContextMessage(goal: string): LlmSystemMessage {
    return {
        role: "system",
        content: [
            "The active goal is:",
            "<goal>",
            goal,
            "</goal>"
        ].join("\n"),
        context: "goal",
        timestamp: Date.now()
    };
}

export type ContextManagerFactory = (permission: () => PermissionMode) => ContextManager;

export class DefaultContextManager implements ContextManager {
    readonly systemPrompt: string;
    private readonly permission: () => PermissionMode;
    private readonly agentInstructions: AgentInstructions;
    private readonly skills: SkillCatalog | null;
    private contextMessage: LlmSystemMessage | null = null;
    private environmentKey: string | null = null;

    constructor(
        permission: () => PermissionMode,
        systemPrompt = SYSTEM_PROMPT,
        agentInstructions = new AgentInstructions(),
        skills: SkillCatalog | null = null
    ) {
        this.permission = permission;
        this.systemPrompt = systemPrompt;
        this.agentInstructions = agentInstructions;
        this.skills = skills;
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
            ...environmentContextFor(
                this.permission(),
                workingDirectories,
                this.agentInstructions.staticInstructions(workingDirectories)
            ),
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

    discoverAgentInstructions(
        paths: readonly string[],
        workingDirectories: readonly string[] = []
    ): readonly AgentInstructionSource[] {
        return this.agentInstructions.discover(paths, workingDirectories);
    }

    prepareRequest(
        history: readonly LlmMessage[],
        workingDirectories: readonly string[] = [],
        options: ContextRequestOptions = {}
    ): ContextRequest {
        const key = environmentKeyFor(this.permission(), workingDirectories);
        let messages: LlmMessage[];
        if (!this.contextMessage) {
            messages = [
                {
                    ...environmentContextFor(
                        this.permission(),
                        workingDirectories,
                        this.agentInstructions.staticInstructions(workingDirectories)
                    ),
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
        const skills = this.skills
            ? availableSkillsMessage(this.skills.discover(workingDirectories))
            : null;
        if (skills) {
            const environmentIndex = messages[0]?.role === "system"
                && messages[0].context === "environment"
                ? 1
                : 0;
            messages.splice(environmentIndex, 0, skills);
        }
        if (options.goal) {
            messages.push(goalContextMessage(options.goal));
        }
        return {
            systemPrompt: systemPromptFor(this.systemPrompt, options),
            messages
        };
    }

    visibleHistory(messages: readonly LlmMessage[]): LlmMessage[] {
        return messages.filter((message) => !(
            message.role === "system" &&
            (
                message.context === "environment"
                || message.context === "goal"
                || message.context === "agent-instructions"
                || message.context === "skills"
                || message.context === "skill"
            )
        ));
    }

    estimateUsage(input: ContextManagerUsageInput): JarvixContextUsage {
        const request = this.prepareRequest(
            input.history,
            input.workingDirectories,
            { goal: input.goal }
        );
        return estimateContextUsage({
            contextWindow: input.contextWindow,
            systemPrompt: request.systemPrompt,
            messages: request.messages,
            tools: input.tools
        });
    }
}

export function createDefaultContextManager(
    permission: () => PermissionMode,
    skills: SkillCatalog | null = null
): ContextManager {
    return new DefaultContextManager(
        permission,
        SYSTEM_PROMPT,
        new AgentInstructions(),
        skills
    );
}
