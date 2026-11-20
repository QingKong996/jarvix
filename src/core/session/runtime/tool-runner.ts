import type {
    LlmMessage,
    LlmToolCallBlock,
    LlmToolResultMessage
} from "../../../llm/types.ts";
import type {
    PermissionDecision,
    PermissionGrantInput,
    PermissionMode
} from "../../../protocol/permission.ts";
import type { SessionPermissions } from "../../permissions/session-permissions.ts";
import {
    createDefaultTools,
    type ToolExecutionResult,
    type ToolExecutor
} from "../../tools/index.ts";
import {
    createToolCallViewData,
    toToolResultDetails,
    type ToolCallViewData
} from "../../tools/view.ts";
import type { SessionRuntime } from "./types.ts";

type ToolCallRunnerOptions = {
    permissions: SessionPermissions;
    append(message: LlmMessage): void;
    queueBackgroundExitNotice(
        runtime: SessionRuntime,
        sessionId: string,
        exitCode: number | null,
        error: string | null,
        unreadCharacters: number
    ): void;
    tools?: ToolExecutor;
};

export class ToolCallRunner {
    private readonly tools: ToolExecutor;
    private readonly permissions: SessionPermissions;
    private readonly append: (message: LlmMessage) => void;
    private readonly queueBackgroundExitNotice: ToolCallRunnerOptions["queueBackgroundExitNotice"];
    private readonly backgroundExitNotices = new Set<string>();

    constructor(options: ToolCallRunnerOptions) {
        this.tools = options.tools ?? createDefaultTools();
        this.permissions = options.permissions;
        this.append = options.append;
        this.queueBackgroundExitNotice = options.queueBackgroundExitNotice;
    }

    get hasActiveWork(): boolean {
        return this.tools.hasActiveWork?.() === true;
    }

    registeredTools(permission: PermissionMode) {
        return this.tools.getRegisteredTools?.(permission) ?? this.tools.definitions;
    }

    async execute(
        toolCall: LlmToolCallBlock,
        runtime: SessionRuntime,
        signal: AbortSignal
    ): Promise<void> {
        if (signal.aborted) {
            this.finishCancelled(toolCall, runtime);
            return;
        }

        runtime.emit({
            type: "tool.start",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            data: createToolCallViewData(toolCall.name, toolCall.arguments, "running")
        });

        let result: ToolExecutionResult;
        if (!this.tools.handles(toolCall.name)) {
            result = failedToolResult(toolCall, `Unknown tool: ${toolCall.name}`);
        } else {
            try {
                result = await this.tools.execute(
                    toolCall,
                    {
                        onOutput: (data) => {
                            if (signal.aborted) {
                                return;
                            }
                            runtime.emit({
                                type: "tool.output",
                                toolCallId: toolCall.id,
                                toolName: toolCall.name,
                                data
                            });
                        },
                        onBackgroundEnd: ({ taskId, exitCode, error, unreadOutput, data, isError }) => {
                            runtime.emit({
                                type: "tool.end",
                                toolCallId: toolCall.id,
                                toolName: toolCall.name,
                                data,
                                isError,
                                endReason: "exited"
                            });
                            if (
                                unreadOutput.length > 0 &&
                                !this.backgroundExitNotices.has(taskId)
                            ) {
                                this.backgroundExitNotices.add(taskId);
                                this.queueBackgroundExitNotice(
                                    runtime,
                                    taskId,
                                    exitCode,
                                    error,
                                    unreadOutput.length
                                );
                            }
                        },
                        onTaskEvent: (event) => {
                            runtime.emit(event);
                        },
                        requestPermission: (request) =>
                            this.requestPermission(request, runtime, signal)
                    },
                    signal
                );
            } catch (error) {
                result = failedToolResult(
                    toolCall,
                    error instanceof Error ? error.message : String(error)
                );
            }
        }

        this.complete(toolCall, result, runtime);
    }

    cancel(toolCall: LlmToolCallBlock, runtime: SessionRuntime): void {
        this.finishCancelled(toolCall, runtime);
    }

    async stop() {
        return this.tools.stop();
    }

    dispose(): void {
        this.tools.dispose();
    }

    private finishCancelled(toolCall: LlmToolCallBlock, runtime: SessionRuntime): void {
        this.complete(
            toolCall,
            failedToolResult(toolCall, "Tool execution stopped."),
            runtime
        );
    }

    private complete(
        toolCall: LlmToolCallBlock,
        result: ToolExecutionResult,
        runtime: SessionRuntime
    ): void {
        runtime.emit({
            type: "tool.end",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            data: result.data,
            isError: result.isError,
            endReason: result.endReason
        });

        const message: LlmToolResultMessage = {
            role: "toolResult",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            content: result.content,
            details: toToolResultDetails(result.data),
            isError: result.isError,
            timestamp: Date.now()
        };
        this.append(message);
    }

    private async requestPermission(
        input: PermissionGrantInput,
        runtime: SessionRuntime,
        signal: AbortSignal
    ): Promise<PermissionDecision> {
        if (signal.aborted) {
            return "cancelled";
        }
        const handle = this.permissions.begin(input, signal);
        runtime.emit({
            type: "permission.request",
            request: handle.request
        });
        const decision = await handle.decision;
        runtime.emit({
            type: "permission.resolved",
            requestId: handle.request.id,
            decision
        });
        return decision;
    }
}

function failedToolResult(toolCall: LlmToolCallBlock, output: string): ToolExecutionResult {
    const data: ToolCallViewData = {
        ...createToolCallViewData(toolCall.name, toolCall.arguments, "failed"),
        output
    };
    return {
        content: output,
        data,
        isError: true,
        endReason: "exited"
    };
}
