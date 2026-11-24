import { createHash } from "node:crypto";
import type {
    LlmImageContent,
    LlmMessage,
    LlmToolCallBlock,
    LlmToolResultContent,
    LlmToolResultMessage
} from "../../../protocol/llm.ts";
import { toolResultContentText } from "../../../protocol/llm.ts";
import type {
    PermissionDecision,
    PermissionGrantInput,
    PermissionMode
} from "../../../protocol/permission.ts";
import { type JarvixLogger, noopLogger } from "../../logger.ts";
import {
    noopAgentObserver,
    type AgentObserver,
    type AgentToolCategory
} from "../../observability/index.ts";
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
    observer?: AgentObserver;
};

export type ToolCallTelemetryResult = {
    outcome: "success" | "error" | "cancelled";
    isError: boolean;
    durationMs: number;
    permissionRequests: number;
    permissionWaitMs: number;
    executionMs: number;
};

export type ToolTelemetryContext = {
    runId: string;
    turnId: string;
    turnIndex: number;
    stepIndex: number;
    repeatIndex: number;
    repeatGroupSize: number;
    onFinished?(result: ToolCallTelemetryResult): void;
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
    private readonly observer: AgentObserver;

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
        this.observer = options.observer ?? noopAgentObserver;
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
        signal: AbortSignal,
        telemetry?: ToolTelemetryContext
    ): Promise<void> {
        if (signal.aborted) {
            this.cancel(toolCall, runtime, telemetry);
            return;
        }
        const startedAt = performance.now();
        const startedAtMs = Date.now();
        const toolSpanId = telemetry
            ? toolSpanIdFor(telemetry)
            : undefined;
        let permissionRequests = 0;
        let permissionWaitMs = 0;
        let unknownTool = false;
        if (telemetry) {
            this.observer.toolStarted({
                toolSpanId: toolSpanId!,
                sessionId: this.sessionId ?? "",
                runId: telemetry.runId,
                turnId: telemetry.turnId,
                turnIndex: telemetry.turnIndex,
                stepIndex: telemetry.stepIndex,
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                toolCategory: toolCategoryFor(toolCall.name),
                startedAtMs,
                argsBytes: jsonBytes(toolCall.arguments),
                argsHash: hashJson(toolCall.arguments)
            });
        }
        this.logger.debug("Tool call started", {
            sessionId: this.sessionId,
            runId: telemetry?.runId,
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
            unknownTool = true;
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
                        requestPermission: async (request) => {
                            permissionRequests += 1;
                            const waitStartedAt = performance.now();
                            try {
                                return await this.requestPermission(
                                    request,
                                    runtime,
                                    signal
                                );
                            } finally {
                                permissionWaitMs += performance.now() - waitStartedAt;
                            }
                        }
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

        let completionError: unknown;
        let completionFailed = false;
        try {
            this.complete(toolCall, result, runtime);
        } catch (error) {
            completionFailed = true;
            completionError = error;
            this.logger.error("Failed to record tool result", error, {
                sessionId: this.sessionId,
                runId: telemetry?.runId,
                toolCallId: toolCall.id,
                toolName: toolCall.name
            });
        }
        const durationMs = elapsedMs(startedAt);
        const executionMs = Math.max(
            0,
            Math.round((durationMs - permissionWaitMs) * 10) / 10
        );
        const outputText = toolResultContentText(result.content);
        const imageCount = result.images?.length ?? 0;
        if (telemetry) {
            const outcome = signal.aborted
                ? "cancelled"
                : result.isError
                    ? "error"
                    : "success";
            this.observer.toolFinished(toolSpanId!, {
                endedAtMs: Date.now(),
                durationMs,
                outcome,
                permissionRequests,
                permissionWaitMs: Math.round(permissionWaitMs * 10) / 10,
                executionMs,
                isError: result.isError,
                endReason: result.endReason,
                errorCode: result.isError
                    ? toolErrorCode(result, unknownTool, signal.aborted)
                    : undefined,
                outputChars: outputText.length,
                outputBytes: Buffer.byteLength(outputText, "utf8"),
                truncated: (result.task?.truncatedCharacters ?? 0) > 0,
                imageCount,
                exitCode: result.task?.exitCode,
                repeatIndex: telemetry.repeatIndex,
                repeatGroupSize: telemetry.repeatGroupSize,
                detail: toolDetail(result)
            });
            telemetry.onFinished?.({
                outcome,
                isError: result.isError,
                durationMs,
                permissionRequests,
                permissionWaitMs,
                executionMs
            });
        }
        this.logger.info("Tool call finished", {
            sessionId: this.sessionId,
            runId: telemetry?.runId,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            isError: result.isError,
            endReason: result.endReason,
            durationMs
        });
        if (completionFailed) {
            throw completionError;
        }
    }

    cancel(
        toolCall: LlmToolCallBlock,
        runtime: SessionRuntime,
        telemetry?: ToolTelemetryContext
    ): void {
        const startedAtMs = Date.now();
        if (telemetry) {
            this.observer.toolStarted({
                toolSpanId: toolSpanIdFor(telemetry),
                sessionId: this.sessionId ?? "",
                runId: telemetry.runId,
                turnId: telemetry.turnId,
                turnIndex: telemetry.turnIndex,
                stepIndex: telemetry.stepIndex,
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                toolCategory: toolCategoryFor(toolCall.name),
                startedAtMs,
                argsBytes: jsonBytes(toolCall.arguments),
                argsHash: hashJson(toolCall.arguments)
            });
        }
        this.logger.warn("Tool call was cancelled", {
            sessionId: this.sessionId,
            runId: telemetry?.runId,
            toolCallId: toolCall.id,
            toolName: toolCall.name
        });
        const result = failedToolResult(toolCall, "Tool execution stopped.");
        let completionError: unknown;
        let completionFailed = false;
        try {
            this.complete(toolCall, result, runtime);
        } catch (error) {
            completionFailed = true;
            completionError = error;
            this.logger.error("Failed to record cancelled tool result", error, {
                sessionId: this.sessionId,
                runId: telemetry?.runId,
                toolCallId: toolCall.id,
                toolName: toolCall.name
            });
        }
        if (telemetry) {
            this.observer.toolFinished(toolSpanIdFor(telemetry), {
                endedAtMs: Date.now(),
                durationMs: 0,
                outcome: "cancelled",
                permissionRequests: 0,
                permissionWaitMs: 0,
                executionMs: 0,
                isError: result.isError,
                endReason: result.endReason,
                errorCode: "tool_cancelled",
                outputChars: 0,
                outputBytes: 0,
                truncated: false,
                imageCount: 0,
                repeatIndex: telemetry.repeatIndex,
                repeatGroupSize: telemetry.repeatGroupSize,
                detail: toolDetail(result)
            });
            telemetry.onFinished?.({
                outcome: "cancelled",
                isError: result.isError,
                durationMs: 0,
                permissionRequests: 0,
                permissionWaitMs: 0,
                executionMs: 0
            });
        }
        if (completionFailed) {
            throw completionError;
        }
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

function toolSpanIdFor(telemetry: ToolTelemetryContext): string {
    return `${telemetry.turnId}:tool${telemetry.stepIndex}`;
}

function toolCategoryFor(name: string): AgentToolCategory {
    switch (name) {
        case "exec_command":
        case "write_stdin":
            return "shell";
        case "apply_patch":
            return "patch";
        case "view_image":
            return "image";
        case "request_permission":
        case "get_local_time":
        case "sleep":
            return "meta";
        default:
            return "other";
    }
}

function jsonBytes(value: unknown): number | undefined {
    try {
        const text = JSON.stringify(value);
        return text === undefined ? undefined : Buffer.byteLength(text, "utf8");
    } catch {
        return undefined;
    }
}

function hashJson(value: unknown): string | undefined {
    try {
        return createHash("sha256")
            .update(JSON.stringify(value) ?? "undefined")
            .digest("hex")
            .slice(0, 16);
    } catch {
        return undefined;
    }
}

function toolDetail(result: ToolExecutionResult): Record<string, unknown> {
    const detail: Record<string, unknown> = {
        kind: result.data.kind,
        background: result.endReason === "background"
    };
    if ("status" in result.data && typeof result.data.status === "string") {
        detail.status = result.data.status;
    }
    if (result.task) {
        detail.exitCode = result.task.exitCode;
        detail.unreadCharacters = result.task.unreadCharacters;
        detail.truncatedCharacters = result.task.truncatedCharacters;
    }
    if (result.images && result.images.length > 0) {
        detail.imageCount = result.images.length;
    }
    return detail;
}

function toolErrorCode(
    result: ToolExecutionResult,
    unknownTool: boolean,
    aborted: boolean
): string {
    if (unknownTool) {
        return "tool_unknown";
    }
    if (aborted) {
        return "tool_cancelled";
    }
    const status = "status" in result.data && typeof result.data.status === "string"
        ? result.data.status
        : undefined;
    if (status === "timed_out") {
        return "tool_timeout";
    }
    const output = toolResultContentText(result.content);
    if (/permission|denied|not allowed|access is restricted/i.test(output)) {
        return "tool_permission_denied";
    }
    if (/not found|does not exist|unknown path/i.test(output)) {
        return "tool_not_found";
    }
    if (/invalid (?:argument|parameter)|invalid json|malformed/i.test(output)) {
        return "tool_invalid_arguments";
    }
    if (/timed? ?out|timeout/i.test(output)) {
        return "tool_timeout";
    }
    if (/truncat/i.test(output)) {
        return "tool_output_truncated";
    }
    if (output.trim().length === 0) {
        return "tool_empty_result";
    }
    return "tool_failed";
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
