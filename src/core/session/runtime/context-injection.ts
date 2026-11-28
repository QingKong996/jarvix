import type {
    LlmMessage,
    LlmSystemMessage,
    LlmToolDefinition,
    LlmToolReference
} from "../../../protocol/llm.ts";

export const CONTEXT_SNAPSHOT_KEYS = {
    skills: "skills",
    environment: "environment",
    agents: "agents",
    mcp: "mcp"
} as const;

export type ContextInjectionPlacement =
    | { at: "start" }
    | { at: "before"; index: number };

export type ContextInjection = {
    declaration?: string;
    content: string;
    timestamp?: number;
    contextKey?: string;
    contextFingerprint?: string;
    toolsAdded?: LlmToolDefinition[];
    toolsRemoved?: LlmToolReference[];
    /**
     * Appending is the default. Inserting anywhere else is allowed only when
     * the caller declares why the ordering must change.
     */
    placement?: ContextInjectionPlacement;
};

export type ContextSnapshotChange =
    | ContextInjection
    | ContextInjection[]
    | null;

export type ContextSnapshotSource = {
    key: string;
    fingerprint: string;
    initial?: ContextInjection | null;
    change?: (
        previousFingerprint: string
    ) => ContextSnapshotChange;
};

/** Tracks the last injected value of each context source. */
export class ContextSnapshotTracker {
    private readonly fingerprints = new Map<string, string>();

    initialize(
        sources: readonly ContextSnapshotSource[]
    ): ContextInjection[] {
        const injections: ContextInjection[] = [];
        for (const source of sources) {
            if (this.fingerprints.has(source.key)) {
                continue;
            }
            this.fingerprints.set(source.key, source.fingerprint);
            if (source.initial) {
                injections.push(withSnapshot(
                    source.initial,
                    source
                ));
            }
        }
        return injections;
    }

    refresh(
        sources: readonly ContextSnapshotSource[]
    ): ContextInjection[] {
        const injections: ContextInjection[] = [];
        for (const source of sources) {
            const previous = this.fingerprints.get(source.key);
            if (previous === undefined) {
                this.fingerprints.set(source.key, source.fingerprint);
                continue;
            }
            if (previous === source.fingerprint) {
                continue;
            }
            this.fingerprints.set(source.key, source.fingerprint);
            const change = source.change?.(previous);
            if (Array.isArray(change)) {
                injections.push(...change.map(
                    (injection) => withSnapshot(injection, source)
                ));
            } else if (change) {
                injections.push(withSnapshot(change, source));
            }
        }
        return injections;
    }

    update(key: string, fingerprint: string): void {
        this.fingerprints.set(key, fingerprint);
    }
}

export function injectContext(
    messages: LlmMessage[],
    injection: ContextInjection
): LlmSystemMessage {
    const message = injectedContextMessage(injection);
    const placement = injection.placement;
    if (!placement) {
        messages.push(message);
        return message;
    }
    requireDeclaration(injection.declaration);
    if (placement.at === "start") {
        messages.unshift(message);
        return message;
    }
    if (
        !Number.isInteger(placement.index)
        || placement.index < 0
        || placement.index > messages.length
    ) {
        throw new Error("Invalid context injection index");
    }
    messages.splice(placement.index, 0, message);
    return message;
}

export function injectedContextMessage(
    injection: ContextInjection
): LlmSystemMessage {
    const declaration = injection.declaration?.trim() ?? "";
    return {
        role: "system",
        content: declaration.length === 0
            ? injection.content.trim()
            : `${declaration}\n\n${injection.content.trim()}`,
        context: "injected",
        timestamp: injection.timestamp ?? Date.now(),
        ...(injection.contextKey
            ? { contextKey: injection.contextKey }
            : {}),
        ...(injection.contextFingerprint
            ? { contextFingerprint: injection.contextFingerprint }
            : {}),
        ...(injection.toolsAdded
            ? { toolsAdded: injection.toolsAdded }
            : {}),
        ...(injection.toolsRemoved
            ? { toolsRemoved: injection.toolsRemoved }
            : {})
    };
}

export function isInjectedContextMessage(
    message: LlmMessage
): message is LlmSystemMessage {
    return message.role === "system"
        && message.context !== undefined;
}

export function isContextInjectionMessage(message: LlmMessage): boolean {
    return isInjectedContextMessage(message)
        || (
            message.role === "user"
            && message.context === "system-reminder"
        );
}

export function isPersistedContextInjectionMessage(
    message: LlmMessage
): message is LlmSystemMessage {
    return isInjectedContextMessage(message)
        && message.contextKey !== undefined
        && message.contextFingerprint !== undefined;
}

function withSnapshot(
    injection: ContextInjection,
    source: ContextSnapshotSource
): ContextInjection {
    return {
        ...injection,
        contextKey: source.key,
        contextFingerprint: source.fingerprint
    };
}

function requireDeclaration(declaration: string | undefined): void {
    if (declaration === undefined || declaration.trim().length === 0) {
        throw new Error("Non-append context injection requires a declaration");
    }
}
