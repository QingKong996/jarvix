import type {
    LlmImageContent,
    LlmMessage,
    LlmToolCallBlock,
    LlmToolResultContent,
    LlmToolResultMessage
} from "../../../protocol/llm.ts";
import type {
    PermissionDecision,
    PermissionGrantInput,
    PermissionMode
} from "../../../protocol/permission.ts";
import { type JarvixLogger, noopLogger } from "../../logger.ts";
import type { SessionPermissions } from "../../permissions/session-permissions.ts";
import {
    ToolManagerRegistry,
    type ToolManager,
    type ToolExecutionResult,
    type ToolExecutor
} from "../../../runtime/tools/index.ts";
import { createDefaultTools } from "../../../runtime/tools/index.ts";
import {
    createToolCallViewData,
    toToolResultDetails,
    type ToolCallViewData
} from "../../../runtime/tools/view.ts";
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
    sessionId?: string;
    logger?: JarvixLogger;
};

export class ToolCallRunner {
    private readonly tools: ToolExecutor;
    private readonly managerRegistry?: ToolManagerRegistry;
    private readonly permissions: SessionPermissions;
    private readonly append: (message: LlmMessage) => void;
    private readonly queueBackgroundExitNotice: ToolCallRunnerOptions["queueBackgroundExitNotice"];
    private readonly backgroundExitNotices = new Set<string>();
    private readonly sessionId: string | undefined;
    private readonly logger: JarvixLogger;

    constructor(options: ToolCallRunnerOptions) {
        this.tools = options.tools ?? createDefaultTools();
        this.managerRegistry = this.tools instanceof ToolManagerRegistry
            ? this.tools
            : undefined;
        this.permissions = options.permissions;
        this.append = options.append;
        this.queueBackgroundExitNotice = options.queueBackgroundExitNotice;
        this.sessionId = options.sessionId;
        this.logger = options.logger ?? noopLogger;
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
        const startedAt = performance.now();
        this.logger.debug("Tool call started", {
            sessionId: this.sessionId,
            toolCallId: toolCall.id,
            toolName: toolCall.name
        });

        runtime.emit({
            type: "tool.start",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            data: createToolCallViewData(toolCall.name, toolCall.arguments, "running")
        });

        let result: ToolExecutionResult;
        if (!this.tools.handles(toolCall.name)) {
            this.logger.warn("Tool call used an unknown tool", {
                sessionId: this.sessionId,
                toolCallId: toolCall.id,
                toolName: toolCall.name
            });
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
                this.logger.error("Tool call failed", error, {
                    sessionId: this.sessionId,
                    toolCallId: toolCall.id,
                    toolName: toolCall.name,
                    durationMs: elapsedMs(startedAt)
                });
                result = failedToolResult(
                    toolCall,
                    error instanceof Error ? error.message : String(error)
                );
            }
        }

        this.complete(toolCall, result, runtime);
        this.logger.info("Tool call finished", {
            sessionId: this.sessionId,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            isError: result.isError,
            endReason: result.endReason,
            durationMs: elapsedMs(startedAt)
        });
    }

    cancel(toolCall: LlmToolCallBlock, runtime: SessionRuntime): void {
        this.finishCancelled(toolCall, runtime);
    }

    async stop() {
        return this.tools.stop();
    }

    registerToolManager(manager: ToolManager): void {
        if (!this.managerRegistry) {
            throw new Error("Tool manager registration requires a dynamic tool registry");
        }
        this.managerRegistry.registerManager(manager);
    }

    async unregisterToolManager(managerId: string): Promise<void> {
        if (!this.managerRegistry) {
            throw new Error("Tool manager registration requires a dynamic tool registry");
        }
        await this.managerRegistry.unregisterManager(managerId);
    }

    dispose(): void {
        this.tools.dispose();
    }

    private finishCancelled(toolCall: LlmToolCallBlock, runtime: SessionRuntime): void {
        this.logger.warn("Tool call was cancelled", {
            sessionId: this.sessionId,
            toolCallId: toolCall.id,
            toolName: toolCall.name
        });
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
            content: toolResultContent(result.content, result.images),
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
        this.logger.info("Tool permission requested", {
            sessionId: this.sessionId,
            requestId: handle.request.id,
            domainChangeCount: input.domains.length,
            directoryChangeCount: input.directories.length
        });
        runtime.emit({
            type: "permission.request",
            request: handle.request
        });
        const decision = await handle.decision;
        this.logger.info("Tool permission resolved", {
            sessionId: this.sessionId,
            requestId: handle.request.id,
            decision
        });
        runtime.emit({
            type: "permission.resolved",
            requestId: handle.request.id,
            decision
        });
        return decision;
    }
}

function elapsedMs(startedAt: number): number {
    return Math.round((performance.now() - startedAt) * 10) / 10;
}

function toolResultContent(
    text: string,
    images: readonly LlmImageContent[] | undefined
): string | LlmToolResultContent[] {
    if (!images || images.length === 0) {
        return text;
    }
    return [
        ...(text.length > 0 ? [{ type: "text" as const, text }] : []),
        ...images
    ];
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
