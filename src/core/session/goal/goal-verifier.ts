import { randomUUID } from "node:crypto";
import type { LlmAdapter, LlmRequest } from "../../llm/adapter.ts";
import type {
    LlmAssistantMessage,
    LlmImageContent,
    LlmMessage,
    LlmToolCallBlock,
    LlmToolDefinition,
    LlmToolResultMessage
} from "../../../protocol/llm.ts";
import type { JarvixConfig } from "../../../protocol/config.ts";
import type { JarvixEvent } from "../../../protocol/event.ts";
import type {
    PermissionDecision,
    PermissionGrantInput,
    PermissionMode
} from "../../../protocol/permission.ts";
import type { JarvixSessionMeta } from "../../../protocol/session.ts";
import {
    resolveConfiguredModel,
    resolveReasoningLevel
} from "../../../protocol/providers.ts";
import { type JarvixLogger, noopLogger } from "../../logger.ts";
import type { SessionPermissions } from "../../permissions/session-permissions.ts";
import type {
    ToolExecutor,
    ToolExecutionResult
} from "../../../runtime/tools/types.ts";
import {
    appendSessionMessageToFile,
    createSessionFile
} from "../persistence/writer.ts";
import { SESSION_FORMAT_VERSION } from "../persistence/records.ts";
import {
    defaultVerifierDirectory,
    verifierFile
} from "../persistence/paths.ts";

export const VERIFY_RESULT_TOOL = "verify_result";
const MAX_VERIFIER_ROUNDS = 64;
const MAX_VERIFIER_RETRIES_WITHOUT_TOOL = 2;

const VERIFY_RESULT_DEFINITION: LlmToolDefinition = {
    name: VERIFY_RESULT_TOOL,
    description: [
        "Record the final verification decision.",
        "Call this exactly once after checking the goal.",
        "The reason is returned to the main agent when verification fails."
    ].join(" "),
    parameters: {
        type: "object",
        properties: {
            passed: {
                type: "boolean",
                description: "Whether the goal has been fully satisfied."
            },
            reason: {
                type: "string",
                description: "Evidence-based explanation for the decision."
            }
        },
        required: ["passed", "reason"],
        additionalProperties: false
    }
};

const VERIFIER_SYSTEM_PROMPT = [
    "You are an independent goal verifier.",
    "You have no access to the main conversation and must verify only the goal below.",
    "Inspect the actual workspace and run checks when needed.",
    "Do not assume that the goal is complete because the main agent said so.",
    "When verification is finished, call verify_result exactly once.",
    "If the goal is not satisfied, explain the concrete remaining problem in reason.",
    "Do not call update_goal or finish_goal."
].join("\n");

const ALLOWED_TOOL_NAMES = new Set([
    "exec_command",
    "write_stdin",
    "apply_patch",
    "request_permission",
    "view_image",
    "get_local_time",
    "sleep"
]);

export type GoalVerificationInput = {
    sessionId: string;
    goal: string;
    permission: PermissionMode;
    workingDirectories: readonly string[];
    llm: LlmAdapter;
    config: JarvixConfig;
    tools: ToolExecutor;
    permissions: SessionPermissions;
    signal: AbortSignal;
    emit(event: JarvixEvent): void;
    logger?: JarvixLogger;
    verifierDirectory?: string;
};

export type GoalVerificationResult = {
    passed: boolean;
    reason: string;
    verificationId: string;
    file: string;
};

type VerificationDecision = {
    passed: boolean;
    reason: string;
};

type VerifyResultOutcome =
    | { kind: "decision"; decision: VerificationDecision }
    | { kind: "invalid"; reason: string };

export class GoalVerifier {
    async verify(input: GoalVerificationInput): Promise<GoalVerificationResult> {
        const logger = input.logger ?? noopLogger;
        const verificationId = `${input.sessionId}-${Date.now()}-${randomUUID().slice(0, 8)}`;
        const file = verifierFile(
            verificationId,
            input.verifierDirectory ?? defaultVerifierDirectory()
        );
        const meta: JarvixSessionMeta = {
            type: "session",
            version: SESSION_FORMAT_VERSION,
            id: verificationId,
            name: "Goal verification",
            createdAt: Date.now(),
            status: "active",
            permission: input.permission
        };
        createSessionFile(file, meta);

        const history: LlmMessage[] = [];
        const append = (message: LlmMessage): void => {
            history.push(message);
            appendSessionMessageToFile(file, message);
        };
        append({
            role: "system",
            content: verifierPrompt(input.goal, input.workingDirectories),
            timestamp: Date.now()
        });
        append({
            role: "user",
            content: `<goal>\n${input.goal}\n</goal>`,
            timestamp: Date.now()
        });

        const resolved = resolveConfiguredModel(
            input.config.providers,
            input.config.selectedModel
        );
        if (!resolved) {
            return failure(verificationId, file, "No model configured.");
        }
        const model = input.llm.getModel(resolved.selection.provider, resolved.selection.id);
        if (!model) {
            return failure(
                verificationId,
                file,
                `Model not found: ${resolved.selection.provider}/${resolved.selection.id}`
            );
        }
        const provider = input.config.providers?.find(
            (item) => item.id === resolved.selection.provider
        );
        const requestBase: Omit<LlmRequest, "messages" | "tools" | "signal"> = {
            model,
            systemPrompt: verifierPrompt(input.goal, input.workingDirectories),
            reasoning: resolveReasoningLevel(resolved.model, input.config.reasoning),
            apiKey: provider?.apiKey,
            maxTokens: resolved.model.maxTokens
        };
        const definitions = toolDefinitions(input.tools, input.permission);
        const executableToolNames = new Set(
            definitions
                .filter((tool) => tool.name !== VERIFY_RESULT_TOOL)
                .map((tool) => tool.name)
        );
        let retriesWithoutTool = 0;

        for (let round = 0; round < MAX_VERIFIER_ROUNDS; round += 1) {
            if (input.signal.aborted) {
                return failure(verificationId, file, "Verification stopped.");
            }
            const assistant = await streamAssistant(
                input.llm,
                {
                    ...requestBase,
                    messages: history,
                    tools: definitions,
                    signal: input.signal
                }
            );
            if (!assistant) {
                return failure(verificationId, file, "Verifier received no model response.");
            }
            append(assistant);
            const toolCalls = assistant.stopReason === "toolUse"
                ? assistant.content.filter(
                    (block): block is LlmToolCallBlock => block.type === "toolCall"
                )
                : [];
            if (toolCalls.length === 0) {
                retriesWithoutTool += 1;
                if (retriesWithoutTool > MAX_VERIFIER_RETRIES_WITHOUT_TOOL) {
                    return failure(
                        verificationId,
                        file,
                        "Verifier did not call verify_result."
                    );
                }
                append({
                    role: "system",
                    content: "You must call verify_result to finish verification.",
                    timestamp: Date.now()
                });
                continue;
            }
            retriesWithoutTool = 0;

            for (const call of toolCalls) {
                if (input.signal.aborted) {
                    return failure(verificationId, file, "Verification stopped.");
                }
                const outcome = verifyResultDecision(call);
                if (outcome?.kind === "decision") {
                    append(toolResultMessage(call, "Verification recorded.", false));
                    return {
                        ...outcome.decision,
                        verificationId,
                        file
                    };
                }
                if (outcome?.kind === "invalid") {
                    append(toolResultMessage(call, outcome.reason, true));
                    continue;
                }
                const result = await executeTool(input, call, executableToolNames);
                append(toolResultMessage(
                    call,
                    result.content,
                    result.isError,
                    result.images
                ));
            }
        }

        logger.warn("Goal verifier exhausted its rounds", {
            sessionId: input.sessionId,
            verificationId
        });
        return failure(
            verificationId,
            file,
            `Verifier did not reach a decision after ${MAX_VERIFIER_ROUNDS} rounds.`
        );
    }
}

function verifierPrompt(
    goal: string,
    workingDirectories: readonly string[]
): string {
    return [
        VERIFIER_SYSTEM_PROMPT,
        `Goal: ${goal}`,
        workingDirectories.length > 0
            ? `Working directories:\n${workingDirectories.map((item) => `- ${item}`).join("\n")}`
            : "No working directory is attached.",
        "Verification transcripts are stored under the session verifier directory."
    ].join("\n\n");
}

async function streamAssistant(
    llm: LlmAdapter,
    request: LlmRequest
): Promise<LlmAssistantMessage | null> {
    let completed: LlmAssistantMessage | null = null;
    for await (const event of llm.stream(request)) {
        if (event.type === "done") {
            completed = event.message;
        } else if (event.type === "error") {
            throw new Error(
                event.message.errorMessage ?? "Verifier model stream failed."
            );
        }
    }
    return completed;
}

function toolDefinitions(
    tools: ToolExecutor,
    permission: PermissionMode
): readonly LlmToolDefinition[] {
    const available = tools.getRegisteredTools?.(permission) ?? tools.definitions;
    return [
        ...available.filter((tool) => ALLOWED_TOOL_NAMES.has(tool.name)),
        VERIFY_RESULT_DEFINITION
    ];
}

function verifyResultDecision(call: LlmToolCallBlock): VerifyResultOutcome | null {
    if (call.name !== VERIFY_RESULT_TOOL) {
        return null;
    }
    const unexpected = Object.keys(call.arguments).filter(
        (key) => key !== "passed" && key !== "reason"
    );
    if (unexpected.length > 0) {
        return {
            kind: "invalid",
            reason: `verify_result only accepts passed and reason. Unexpected fields: ${unexpected.join(", ")}`
        };
    }
    const { passed, reason } = call.arguments;
    if (typeof passed !== "boolean" || typeof reason !== "string") {
        return {
            kind: "invalid",
            reason: "verify_result requires a boolean passed and a string reason."
        };
    }
    const normalizedReason = reason.trim();
    if (normalizedReason.length === 0) {
        return {
            kind: "invalid",
            reason: "verify_result requires a non-empty reason."
        };
    }
    return {
        kind: "decision",
        decision: {
            passed,
            reason: normalizedReason
        }
    };
}

async function executeTool(
    input: GoalVerificationInput,
    call: LlmToolCallBlock,
    allowedToolNames: ReadonlySet<string>
): Promise<ToolExecutionResult> {
    if (!allowedToolNames.has(call.name) || !input.tools.handles(call.name)) {
        return errorResult(call, `Tool is not available to the verifier: ${call.name}`);
    }
    try {
        return await input.tools.execute(
            call,
            {
                onOutput: () => undefined,
                onTaskEvent: () => undefined,
                onBackgroundEnd: () => undefined,
                requestPermission: async (request) => (
                    requestPermission(input, request)
                )
            },
            input.signal
        );
    } catch (error) {
        return errorResult(
            call,
            error instanceof Error ? error.message : String(error)
        );
    }
}

async function requestPermission(
    input: GoalVerificationInput,
    request: PermissionGrantInput
): Promise<PermissionDecision> {
    const handle = input.permissions.begin(request, input.signal);
    input.emit({
        type: "permission.request",
        request: handle.request
    });
    let decision: PermissionDecision;
    try {
        decision = await handle.decision;
    } catch {
        decision = "cancelled";
    }
    input.emit({
        type: "permission.resolved",
        requestId: handle.request.id,
        decision
    });
    return decision;
}

function toolResultMessage(
    call: LlmToolCallBlock,
    content: string,
    isError: boolean,
    images?: readonly LlmImageContent[]
): LlmToolResultMessage {
    return {
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name,
        content: images && images.length > 0
            ? [
                ...(content.length > 0 ? [{ type: "text" as const, text: content }] : []),
                ...images
            ]
            : content,
        isError,
        timestamp: Date.now()
    };
}

function errorResult(
    call: LlmToolCallBlock,
    content: string
): ToolExecutionResult {
    return {
        content,
        data: {
            kind: "generic",
            name: call.name,
            arguments: call.arguments,
            output: content,
            status: "failed"
        },
        isError: true,
        endReason: "exited"
    };
}

function failure(
    verificationId: string,
    file: string,
    reason: string
): GoalVerificationResult {
    return {
        passed: false,
        reason,
        verificationId,
        file
    };
}

export function verifierResultText(result: GoalVerificationResult): string {
    return result.passed
        ? "Independent verification passed. The goal has been cleared."
        : `Independent verification failed:\n${result.reason}`;
}
