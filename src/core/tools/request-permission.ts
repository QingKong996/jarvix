import { isAbsolute, resolve } from "node:path";
import type { LlmToolCallBlock, LlmToolDefinition } from "../../llm/types.ts";
import {
    permissionGrantInputSchema,
    type PermissionAction,
    type PermissionDirectoryChange,
    type PermissionGrantInput,
    type PermissionMode
} from "../../protocol/permission.ts";
import type { SandboxPolicy } from "../permissions/sandbox.ts";
import { permissionPathKey } from "../permissions/path-key.ts";
import type {
    ToolExecutionResult,
    ToolExecutionObserver,
    ToolExecutor,
    ToolStopEvent
} from "./types.ts";
import {
    REQUEST_PERMISSION_TOOL,
    createToolCallViewData,
    type PermissionRequestView
} from "./view.ts";

export { REQUEST_PERMISSION_TOOL } from "./view.ts";

export const REQUEST_PERMISSION_TOOL_DEFINITIONS: readonly LlmToolDefinition[] = [{
    name: REQUEST_PERMISSION_TOOL,
    description: [
        "Request temporary sandbox permission changes for the current session.",
        "Each domain change enables or disables a network host.",
        "Each directory change enables or disables read or write access for an absolute path.",
        "Call this only when the sandbox blocks an operation the user asked for.",
        "The user approves or cancels the request in the app.",
        "Approval applies only to this session and is not saved to disk."
    ].join(" "),
    parameters: {
        type: "object",
        properties: {
            domains: {
                type: "array",
                maxItems: 64,
                description: "Network domain changes.",
                items: {
                    type: "object",
                    properties: {
                        action: {
                            type: "string",
                            enum: ["enable", "disable"],
                            description: "Enable or disable access to the domain."
                        },
                        domain: {
                            type: "string",
                            description: "Host or pattern, such as registry.npmjs.org or *.example.com."
                        }
                    },
                    required: ["action", "domain"],
                    additionalProperties: false
                }
            },
            directories: {
                type: "array",
                maxItems: 64,
                description: "Filesystem directory changes.",
                items: {
                    type: "object",
                    properties: {
                        action: {
                            type: "string",
                            enum: ["enable", "disable"],
                            description: "Enable or disable the requested access."
                        },
                        access: {
                            type: "string",
                            enum: ["read", "write"],
                            description: "Filesystem access to change."
                        },
                        path: {
                            type: "string",
                            description: "Absolute directory path."
                        }
                    },
                    required: ["action", "access", "path"],
                    additionalProperties: false
                }
            }
        },
        required: ["domains", "directories"],
        additionalProperties: false
    }
}];

export type RequestPermissionToolOptions = {
    sandboxPolicy?: () => SandboxPolicy | null;
};

export class RequestPermissionTool implements ToolExecutor {
    readonly definitions = REQUEST_PERMISSION_TOOL_DEFINITIONS;
    private readonly sandboxPolicy?: () => SandboxPolicy | null;

    constructor(options: RequestPermissionToolOptions = {}) {
        this.sandboxPolicy = options.sandboxPolicy;
    }

    getRegisteredTools(permission: PermissionMode): readonly LlmToolDefinition[] {
        return permission === "full-access" ? [] : this.definitions;
    }

    handles(name: string): boolean {
        return name === REQUEST_PERMISSION_TOOL;
    }

    async execute(
        call: LlmToolCallBlock,
        observer: ToolExecutionObserver,
        signal?: AbortSignal
    ): Promise<ToolExecutionResult> {
        const parsed = permissionGrantInputSchema.safeParse(call.arguments);
        if (!parsed.success) {
            return result(call, "cancelled", parsed.error.message, true, "failed");
        }
        if (this.sandboxPolicy && this.sandboxPolicy() === null) {
            return result(
                call,
                "cancelled",
                "The sandbox is not active for this session; permission changes cannot be requested.",
                true,
                "failed"
            );
        }

        const directories = new Map<string, PermissionDirectoryChange>();
        const directoryActions = new Map<string, PermissionAction>();
        for (const change of parsed.data.directories) {
            if (!isAbsolute(change.path)) {
                return result(
                    call,
                    "cancelled",
                    "Every requested directory path must be an absolute path.",
                    true,
                    "failed"
                );
            }
            const path = resolve(change.path);
            const targetKey = `${change.access}\0${permissionPathKey(path)}`;
            const existingAction = directoryActions.get(targetKey);
            if (existingAction && existingAction !== change.action) {
                return result(
                    call,
                    "cancelled",
                    "The same directory access cannot be enabled and disabled in one request.",
                    true,
                    "failed"
                );
            }
            directoryActions.set(targetKey, change.action);
            directories.set(`${change.action}\0${targetKey}`, { ...change, path });
        }
        if (!observer.requestPermission) {
            return result(
                call,
                "cancelled",
                "Permission requests are not available in this environment.",
                true,
                "failed"
            );
        }

        const request: PermissionGrantInput = {
            domains: parsed.data.domains,
            directories: [...directories.values()]
        };
        const decision = await observer.requestPermission(request);
        if (decision === "approved") {
            return result(
                call,
                "approved",
                approvalMessage(request),
                false,
                "completed",
                request
            );
        }
        if (signal?.aborted) {
            return result(
                call,
                "cancelled",
                "The permission request was cancelled because the task stopped.",
                true,
                "failed",
                request
            );
        }
        return result(
            call,
            "cancelled",
            "The user cancelled the permission request. No permission changes were applied.",
            false,
            "completed",
            request
        );
    }

    dispose(): void {
        // No resources to release.
    }

    async stop(): Promise<readonly ToolStopEvent[]> {
        return [];
    }
}

function result(
    call: LlmToolCallBlock,
    decision: PermissionRequestView["decision"],
    output: string,
    isError: boolean,
    status: PermissionRequestView["status"],
    request?: PermissionGrantInput
): ToolExecutionResult {
    const data: PermissionRequestView = request
        ? {
            kind: "permission.request",
            domains: request.domains,
            directories: request.directories,
            decision,
            output,
            status
        }
        : {
            ...createToolCallViewData(call.name, call.arguments, status) as PermissionRequestView,
            decision,
            output,
            status
        };
    return {
        content: output,
        data,
        isError,
        endReason: "exited"
    };
}

function approvalMessage(request: PermissionGrantInput): string {
    const sections = [
        "Permission changes approved for the current session and applied to subsequent sandboxed tool calls.",
        "These changes are kept in memory only and are discarded when Jarvix exits."
    ];
    appendSection(
        sections,
        "Enabled domains",
        request.domains
            .filter((change) => change.action === "enable")
            .map((change) => change.domain)
    );
    appendSection(
        sections,
        "Disabled domains",
        request.domains
            .filter((change) => change.action === "disable")
            .map((change) => change.domain)
    );
    for (const access of ["read", "write"] as const) {
        appendSection(
            sections,
            `${access === "read" ? "Read" : "Write"} access enabled`,
            request.directories
                .filter((change) => change.access === access && change.action === "enable")
                .map((change) => change.path)
        );
        appendSection(
            sections,
            `${access === "read" ? "Read" : "Write"} access disabled`,
            request.directories
                .filter((change) => change.access === access && change.action === "disable")
                .map((change) => change.path)
        );
    }
    return sections.join("\n\n");
}

function appendSection(sections: string[], title: string, values: readonly string[]): void {
    if (values.length > 0) {
        sections.push(`${title}:\n${values.map((value) => `- ${value}`).join("\n")}`);
    }
}
