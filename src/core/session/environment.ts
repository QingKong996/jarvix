import type {
    LlmMessage,
    LlmSystemMessage,
    LlmUserMessage
} from "../../llm/types.ts";
import type { PermissionMode } from "../../protocol/permission.ts";

export const SYSTEM_PROMPT = `Respond to the user in Chinese. Current operating system: ${process.platform}.`;

export function environmentContextFor(
    permission: PermissionMode,
    workingDirectories: readonly string[] = []
): LlmSystemMessage {
    const writableRoots = permission === "project-read-write" || permission === "auto-review"
        ? workingDirectories
        : [];
    const access = permission === "full-access"
        ? [
            `- permission: ${permission}`,
            "- sandbox: off",
            "- access: OS permissions only"
        ]
        : [
            `- permission: ${permission}`,
            "- sandbox: on",
            writableRoots.length > 0
                ? "- writes: writable roots and the sandbox's private temp only"
                : "- writes: denied except the sandbox's private temp",
            "- reads: not restricted by Jarvix; sandbox/OS rules apply",
            "- To enable or disable network domains or filesystem read/write access for this session, call request_permission with absolute directory paths.",
            "- Permission grants are in-memory only and are not restored after Jarvix restarts."
        ];
    const writableRootsLine = permission === "full-access"
        ? null
        : writableRoots.length === 0
            ? "- writable roots: none"
            : "- writable roots:";
    const workingDirectoriesLines = workingDirectories.length === 0
        ? ["Working directories:", "- none"]
        : [
            "Working directories:",
            ...workingDirectories.map((directory) => `- ${directory}`),
            "Use one of these directories as cwd for shell commands and apply_patch when appropriate."
        ];

    return {
        role: "system",
        content: [
            "<environment_context>",
            "Access control:",
            ...access,
            ...(writableRootsLine === null ? [] : [writableRootsLine]),
            ...writableRoots.map((root) => `  - ${root}`),
            ...workingDirectoriesLines,
            "</environment_context>"
        ].join("\n"),
        timestamp: Date.now()
    };
}

export function environmentKeyFor(
    permission: PermissionMode,
    workingDirectories: readonly string[] = []
): string {
    return JSON.stringify([permission, workingDirectories]);
}

export function environmentReminderFor(
    permission: PermissionMode,
    workingDirectories: readonly string[] = []
): { persisted: LlmUserMessage; display: LlmSystemMessage } {
    const display = environmentContextFor(permission, workingDirectories);
    return {
        persisted: {
            role: "user",
            content: [
                "<system-reminder>",
                "The session environment changed. Current environment:",
                display.content,
                "</system-reminder>"
            ].join("\n"),
            context: "system-reminder",
            timestamp: display.timestamp
        },
        display
    };
}

export function isEnvironmentReminderMessage(message: LlmMessage): message is LlmUserMessage {
    return message.role === "user"
        && message.context === "system-reminder"
        && /<environment_context>[\s\S]*<\/environment_context>/.test(message.content);
}

export function isEnvironmentContextMessage(message: LlmMessage): message is LlmSystemMessage {
    return message.role === "system" && message.context === "environment";
}
