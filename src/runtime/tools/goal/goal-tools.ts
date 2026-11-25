import type {
    LlmToolCallBlock,
    LlmToolDefinition
} from "../../../protocol/llm.ts";
import type {
    Tool,
    ToolExecutionContext,
    ToolManager
} from "../tool-manager.ts";
import type { ToolExecutionResult } from "../types.ts";
import { createGenericToolCallViewData } from "../tool-view.ts";

export const GOAL_TOOL_MANAGER_ID = "jarvix.goal";
export const UPDATE_GOAL_TOOL = "update_goal";
export const FINISH_GOAL_TOOL = "finish_goal";

const TOOL_DEFINITIONS: readonly LlmToolDefinition[] = [
    {
        name: UPDATE_GOAL_TOOL,
        description: [
            "Replace the active goal content.",
            "Use this when the user changes the goal or when new information makes the goal more precise.",
            "This tool cannot complete, pause, or change the goal status."
        ].join(" "),
        parameters: {
            type: "object",
            properties: {
                content: {
                    type: "string",
                    description: "The complete replacement goal."
                }
            },
            required: ["content"],
            additionalProperties: false
        }
    },
    {
        name: FINISH_GOAL_TOOL,
        description: [
            "Request independent verification that the active goal is complete.",
            "Call this with no arguments.",
            "If verification fails, the verifier reason is returned as the tool result."
        ].join(" "),
        parameters: {
            type: "object",
            properties: {},
            additionalProperties: false
        }
    }
];

export type GoalFinishResult = {
    passed: boolean;
    reason: string;
};

export type GoalToolHost = {
    getGoal(): string | undefined;
    updateGoal(content: string): void;
    finishGoal(signal: AbortSignal): Promise<GoalFinishResult>;
};

export function createGoalToolManager(host: GoalToolHost): ToolManager {
    return {
        id: GOAL_TOOL_MANAGER_ID,
        create() {
            return [createGoalTool(host)];
        }
    };
}

function createGoalTool(host: GoalToolHost): Tool {
    return {
        definitions: TOOL_DEFINITIONS,
        getRegisteredTools() {
            return host.getGoal() ? TOOL_DEFINITIONS : [];
        },
        async execute(call, context) {
            if (call.name === UPDATE_GOAL_TOOL) {
                return updateGoal(call, context, host);
            }
            if (call.name === FINISH_GOAL_TOOL) {
                return finishGoal(call, context, host);
            }
            return toolResult(call, `Unknown goal tool: ${call.name}`, true);
        }
    };
}

function updateGoal(
    call: LlmToolCallBlock,
    context: ToolExecutionContext,
    host: GoalToolHost
): ToolExecutionResult {
    if (!host.getGoal()) {
        return toolResult(call, "There is no active goal.", true);
    }
    const unexpected = Object.keys(call.arguments).filter((key) => key !== "content");
    if (unexpected.length > 0) {
        return toolResult(
            call,
            `update_goal only accepts content. Unexpected fields: ${unexpected.join(", ")}`,
            true
        );
    }
    const content = call.arguments.content;
    if (typeof content !== "string" || content.trim().length === 0) {
        return toolResult(call, "update_goal requires non-empty content.", true);
    }
    try {
        host.updateGoal(content);
        context.onOutput({
            kind: "generic",
            output: "Goal updated."
        });
        return toolResult(call, "Goal updated.");
    } catch (error) {
        return toolResult(
            call,
            error instanceof Error ? error.message : String(error),
            true
        );
    }
}

async function finishGoal(
    call: LlmToolCallBlock,
    context: ToolExecutionContext,
    host: GoalToolHost
): Promise<ToolExecutionResult> {
    if (!host.getGoal()) {
        return toolResult(call, "There is no active goal.", true);
    }
    if (Object.keys(call.arguments).length > 0) {
        return toolResult(
            call,
            "finish_goal does not accept arguments, including a summary.",
            true
        );
    }
    const result = await host.finishGoal(context.signal);
    return toolResult(
        call,
        result.reason,
        !result.passed
    );
}

function toolResult(
    call: LlmToolCallBlock,
    output: string,
    isError = false
): ToolExecutionResult {
    return {
        content: output,
        data: {
            ...createGenericToolCallViewData(
                call.name,
                call.arguments,
                isError ? "failed" : "completed"
            ),
            output
        },
        isError,
        endReason: "exited"
    };
}
