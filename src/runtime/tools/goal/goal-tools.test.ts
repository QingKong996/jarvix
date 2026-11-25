import { describe, expect, test, vi } from "vitest";
import type { LlmToolCallBlock } from "../../../protocol/llm.ts";
import type {
    ToolExecutionContext,
    ToolManagerContext
} from "../tool-manager.ts";
import {
    createGoalToolManager,
    FINISH_GOAL_TOOL,
    UPDATE_GOAL_TOOL,
    type GoalToolHost
} from "./goal-tools.ts";

const managerContext: ToolManagerContext = {
    sessionId: "session-1",
    permission: () => "read-only",
    workingDirectories: () => []
};

function call(
    name: string,
    arguments_: Record<string, unknown> = {}
): LlmToolCallBlock {
    return {
        type: "toolCall",
        id: `call-${name}`,
        name,
        arguments: arguments_
    };
}

function context(signal = new AbortController().signal): ToolExecutionContext {
    return {
        sessionId: managerContext.sessionId,
        permission: "read-only",
        workingDirectories: [],
        signal,
        onOutput: vi.fn()
    };
}

function createTool(host: GoalToolHost) {
    return createGoalToolManager(host).create(managerContext)[0]!;
}

describe("goal tool registration", () => {
    test("registers update_goal and finish_goal only while a goal is active", () => {
        let goal: string | undefined;
        const tool = createTool({
            getGoal: () => goal,
            updateGoal: vi.fn(),
            finishGoal: vi.fn()
        });

        expect(tool.getRegisteredTools?.("read-only")).toEqual([]);

        goal = "Ship feature A";

        expect(tool.getRegisteredTools?.("read-only")).toEqual(
            tool.definitions
        );
    });
});

describe("update_goal", () => {
    test("updates an active goal and reports progress", async () => {
        const updateGoal = vi.fn();
        const tool = createTool({
            getGoal: () => "Old goal",
            updateGoal,
            finishGoal: vi.fn()
        });
        const execution = context();

        const result = await tool.execute(
            call(UPDATE_GOAL_TOOL, { content: "New goal" }),
            execution
        );

        expect(updateGoal).toHaveBeenCalledWith("New goal");
        expect(execution.onOutput).toHaveBeenCalledWith({
            kind: "generic",
            output: "Goal updated."
        });
        expect(result).toMatchObject({
            content: "Goal updated.",
            isError: false,
            endReason: "exited"
        });
        expect(result.data).toMatchObject({
            kind: "generic",
            output: "Goal updated.",
            status: "completed"
        });
    });

    test("rejects updates without an active goal", async () => {
        const updateGoal = vi.fn();
        const result = await createTool({
            getGoal: () => undefined,
            updateGoal,
            finishGoal: vi.fn()
        }).execute(
            call(UPDATE_GOAL_TOOL, { content: "New goal" }),
            context()
        );

        expect(updateGoal).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            content: "There is no active goal.",
            isError: true
        });
    });

    test("rejects empty or whitespace-only content", async () => {
        const updateGoal = vi.fn();
        const tool = createTool({
            getGoal: () => "Old goal",
            updateGoal,
            finishGoal: vi.fn()
        });

        for (const content of ["", "   ", "\n\t"]) {
            const result = await tool.execute(
                call(UPDATE_GOAL_TOOL, { content }),
                context()
            );
            expect(result.isError).toBe(true);
            expect(result.content).toContain("requires non-empty content");
        }
        expect(updateGoal).not.toHaveBeenCalled();
    });

    test("rejects fields that could be mistaken for a status change", async () => {
        const updateGoal = vi.fn();
        const result = await createTool({
            getGoal: () => "Old goal",
            updateGoal,
            finishGoal: vi.fn()
        }).execute(
            call(UPDATE_GOAL_TOOL, {
                content: "New goal",
                status: "completed"
            }),
            context()
        );

        expect(updateGoal).not.toHaveBeenCalled();
        expect(result).toMatchObject({ isError: true });
        expect(result.content).toContain("Unexpected fields: status");
    });

    test("turns a host persistence error into a tool error", async () => {
        const result = await createTool({
            getGoal: () => "Old goal",
            updateGoal: () => {
                throw new Error("write failed");
            },
            finishGoal: vi.fn()
        }).execute(
            call(UPDATE_GOAL_TOOL, { content: "New goal" }),
            context()
        );

        expect(result).toMatchObject({
            content: "write failed",
            isError: true
        });
    });
});

describe("finish_goal", () => {
    test("passes the request signal to independent verification", async () => {
        const finishGoal = vi.fn(async () => ({
            passed: true,
            reason: "verified"
        }));
        const controller = new AbortController();
        const tool = createTool({
            getGoal: () => "Active goal",
            updateGoal: vi.fn(),
            finishGoal
        });

        const result = await tool.execute(
            call(FINISH_GOAL_TOOL),
            context(controller.signal)
        );

        expect(finishGoal).toHaveBeenCalledWith(controller.signal);
        expect(result).toMatchObject({
            content: "verified",
            isError: false
        });
    });

    test("returns verification failure as an error result", async () => {
        const result = await createTool({
            getGoal: () => "Active goal",
            updateGoal: vi.fn(),
            finishGoal: vi.fn(async () => ({
                passed: false,
                reason: "Missing tests"
            }))
        }).execute(call(FINISH_GOAL_TOOL), context());

        expect(result).toMatchObject({
            content: "Missing tests",
            isError: true
        });
    });

    test("rejects any arguments including a summary", async () => {
        const finishGoal = vi.fn();
        const result = await createTool({
            getGoal: () => "Active goal",
            updateGoal: vi.fn(),
            finishGoal
        }).execute(
            call(FINISH_GOAL_TOOL, { summary: "Done" }),
            context()
        );

        expect(finishGoal).not.toHaveBeenCalled();
        expect(result).toMatchObject({ isError: true });
        expect(result.content).toContain("does not accept arguments");
    });

    test("rejects completion without an active goal", async () => {
        const finishGoal = vi.fn();
        const result = await createTool({
            getGoal: () => undefined,
            updateGoal: vi.fn(),
            finishGoal
        }).execute(call(FINISH_GOAL_TOOL), context());

        expect(finishGoal).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            content: "There is no active goal.",
            isError: true
        });
    });
});

test("unknown goal tools fail explicitly", async () => {
    const result = await createTool({
        getGoal: () => "Active goal",
        updateGoal: vi.fn(),
        finishGoal: vi.fn()
    }).execute(call("unknown_goal_tool"), context());

    expect(result).toMatchObject({
        content: "Unknown goal tool: unknown_goal_tool",
        isError: true
    });
});
