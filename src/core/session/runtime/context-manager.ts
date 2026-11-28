import type {
    LlmMessage,
    LlmToolDefinition
} from "../../../protocol/llm.ts";
import type { JarvixContextUsage } from "../../../protocol/context-usage.ts";
import type { PermissionMode } from "../../../protocol/permission.ts";
import {
    AgentInstructions,
    type AgentInstructionSource
} from "./agent-instructions.ts";
import {
    availableSkillsContext,
    type SkillCatalog
} from "../../skills/skill-catalog.ts";
import { estimateContextUsage } from "./context-usage.ts";
import {
    SYSTEM_PROMPT,
    environmentContextFor
} from "./environment.ts";
import {
    CONTEXT_SNAPSHOT_KEYS,
    type ContextSnapshotSource,
    isContextInjectionMessage,
    isPersistedContextInjectionMessage
} from "./context-injection.ts";

export type ContextRequest = {
    systemPrompt: string;
    messages: LlmMessage[];
};

export type ContextRequestOptions = {
    requireFinishGoal?: boolean;
};

export type ContextManagerUsageInput = {
    contextWindow: number;
    history: readonly LlmMessage[];
    tools?: readonly LlmToolDefinition[];
};

export interface ContextManager {
    readonly systemPrompt: string;
    contextSources?(
        workingDirectories?: readonly string[]
    ): readonly ContextSnapshotSource[];
    contextSource?(
        key: string,
        workingDirectories?: readonly string[]
    ): ContextSnapshotSource | null;
    initializeHistory(messages: readonly LlmMessage[]): LlmMessage[];
    discoverAgentInstructions?(
        paths: readonly string[],
        workingDirectories?: readonly string[]
    ): readonly AgentInstructionSource[];
    prepareRequest(
        history: readonly LlmMessage[],
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

export type ContextManagerFactory = (permission: () => PermissionMode) => ContextManager;

export class DefaultContextManager implements ContextManager {
    readonly systemPrompt: string;
    private readonly permission: () => PermissionMode;
    private readonly agentInstructions: AgentInstructions;
    private readonly skills: SkillCatalog | null;

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
        return messages.filter((message) => (
            !isContextInjectionMessage(message)
            || isPersistedContextInjectionMessage(message)
        ));
    }

    contextSources(
        workingDirectories: readonly string[] = []
    ): readonly ContextSnapshotSource[] {
        return [
            this.contextSource(CONTEXT_SNAPSHOT_KEYS.skills, workingDirectories)!,
            this.contextSource(CONTEXT_SNAPSHOT_KEYS.environment, workingDirectories)!,
            this.contextSource(CONTEXT_SNAPSHOT_KEYS.agents, workingDirectories)!
        ];
    }

    contextSource(
        key: string,
        workingDirectories: readonly string[] = []
    ): ContextSnapshotSource | null {
        if (key === CONTEXT_SNAPSHOT_KEYS.skills) {
            return this.skillsSource(workingDirectories);
        }
        if (key === CONTEXT_SNAPSHOT_KEYS.environment) {
            return this.environmentSource(workingDirectories);
        }
        if (key === CONTEXT_SNAPSHOT_KEYS.agents) {
            return this.agentsSource(workingDirectories);
        }
        return null;
    }

    discoverAgentInstructions(
        paths: readonly string[],
        workingDirectories: readonly string[] = []
    ): readonly AgentInstructionSource[] {
        return this.agentInstructions.discover(paths, workingDirectories);
    }

    prepareRequest(
        history: readonly LlmMessage[],
        options: ContextRequestOptions = {}
    ): ContextRequest {
        return {
            systemPrompt: systemPromptFor(this.systemPrompt, options),
            messages: [...history]
        };
    }

    visibleHistory(messages: readonly LlmMessage[]): LlmMessage[] {
        return messages.filter((message) => !isContextInjectionMessage(message));
    }

    estimateUsage(input: ContextManagerUsageInput): JarvixContextUsage {
        const request = this.prepareRequest(input.history);
        return estimateContextUsage({
            contextWindow: input.contextWindow,
            systemPrompt: request.systemPrompt,
            messages: request.messages,
            tools: input.tools
        });
    }

    private skillsSource(
        workingDirectories: readonly string[]
    ): ContextSnapshotSource {
        const context = availableSkillsContext(
            this.skills?.discover(workingDirectories) ?? []
        );
        return {
            key: CONTEXT_SNAPSHOT_KEYS.skills,
            fingerprint: context.fingerprint,
            initial: context.hasSkills
                ? {
                    declaration: [
                        "Available skills were discovered when the",
                        "session was created."
                    ].join(" "),
                    content: context.content
                }
                : null,
            change: (previousFingerprint) => {
                const previousNames = skillNamesFromFingerprint(
                    previousFingerprint
                );
                if (!previousNames) {
                    return [];
                }
                const previous = new Set(previousNames);
                const current = new Set(
                    context.skills.map((skill) => skill.name)
                );
                return [
                    ...context.skills
                        .filter((skill) => !previous.has(skill.name))
                        .map((skill) => ({
                            declaration: `Skill "${skill.name}" was added.`,
                            content: availableSkillsContext([skill]).content
                        })),
                    ...previousNames
                        .filter((name) => !current.has(name))
                        .map((name) => ({
                            declaration: `Skill "${name}" was removed.`,
                            content: `Removed skill: "${name}".`
                        }))
                ];
            }
        };
    }

    private environmentSource(
        workingDirectories: readonly string[]
    ): ContextSnapshotSource {
        const content = environmentContextFor(
            this.permission(),
            workingDirectories
        ).content;
        return {
            key: CONTEXT_SNAPSHOT_KEYS.environment,
            fingerprint: content,
            initial: {
                declaration: [
                    "The session environment was initialized for the",
                    "current permission and working directories."
                ].join(" "),
                content
            },
            change: () => ({
                declaration: [
                    "The session environment changed. Apply the current",
                    "permission and working directories."
                ].join(" "),
                content
            })
        };
    }

    private agentsSource(
        workingDirectories: readonly string[]
    ): ContextSnapshotSource {
        const snapshot = this.agentInstructions.snapshot(workingDirectories);
        return {
            key: CONTEXT_SNAPSHOT_KEYS.agents,
            fingerprint: snapshot.fingerprint,
            initial: snapshot.sources.length > 0
                ? {
                    declaration: [
                        "AGENTS.md instructions were loaded when the",
                        "session was created."
                    ].join(" "),
                    content: snapshot.content
                }
                : null,
            change: () => ({
                declaration: [
                    "AGENTS.md instructions changed. Use only the current",
                    "instructions below."
                ].join(" "),
                content: snapshot.content
            })
        };
    }
}

function skillNamesFromFingerprint(value: string): string[] | null {
    try {
        const parsed = JSON.parse(value) as unknown;
        if (!Array.isArray(parsed)) {
            return null;
        }
        return parsed.flatMap((item) => (
            Array.isArray(item) && typeof item[0] === "string"
                ? [item[0]]
                : []
        ));
    } catch {
        return null;
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
