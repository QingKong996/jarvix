import { expect, test } from "vitest";
import type { JarvixEvent } from "../../../protocol/event.ts";
import type { ToolTaskSnapshot, ToolTaskState } from "../../../core/tools/types.ts";
import {
    MAX_TOOL_OUTPUT_CHARS,
    OUTPUT_TRUNCATION_NOTICE
} from "../../../core/tools/output.ts";
import {
    backgroundTasksFor,
    clearBackgroundTasks,
    ingestBackgroundTasks,
    reduceBackgroundTasks
} from "./store.ts";

test("keeps completed tasks only until their buffered output is consumed", () => {
    const task = snapshot("task-1", "first");
    const second = snapshot("task-2", "second");
    const started = reduceBackgroundTasks([], [
        { type: "backgroundTask.start", task },
        { type: "backgroundTask.start", task: second },
        {
            type: "backgroundTask.output",
            taskId: task.id,
            output: "later\n",
            truncatedCharacters: 0
        }
    ]);

    expect(started.map((item) => item.id)).toEqual(["task-1", "task-2"]);
    expect(started[0]?.output).toBe("start\nlater\n");

    const ended = reduceBackgroundTasks(started, [{
        type: "backgroundTask.end",
        task: state(task, {
            status: "completed",
            exitCode: 0,
            unreadCharacters: 6
        })
    }]);
    expect(ended).toHaveLength(2);
    expect(ended[0]).toMatchObject({
        id: "task-1",
        status: "completed",
        unreadCharacters: 6
    });

    const consumed = reduceBackgroundTasks(ended, [{
        type: "backgroundTask.consume",
        task: state(task, {
            status: "completed",
            exitCode: 0,
            unreadCharacters: 0
        })
    }] satisfies JarvixEvent[]);
    expect(consumed.map((item) => item.id)).toEqual(["task-2"]);
});

test("bounds retained task output and tracks discarded characters", () => {
    const task = snapshot("task-1", "noisy");
    const output = `${"prefix\n".repeat(MAX_TOOL_OUTPUT_CHARS)}tail\n`;
    const next = reduceBackgroundTasks([task], [{
        type: "backgroundTask.output",
        taskId: task.id,
        output,
        truncatedCharacters: output.length - MAX_TOOL_OUTPUT_CHARS
    }]);

    expect(next[0]?.output.length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_CHARS);
    expect(next[0]?.output).toContain(OUTPUT_TRUNCATION_NOTICE);
    expect(next[0]?.output).toContain("tail\n");
    expect(next[0]?.truncatedCharacters).toBeGreaterThan(0);
});

test("clears deleted session tasks without affecting other sessions", () => {
    const deletedTask = snapshot("task-delete", "deleted");
    const retainedTask = snapshot("task-retain", "retained");
    ingestBackgroundTasks("session-delete", [{
        type: "backgroundTask.start",
        task: deletedTask
    }]);
    ingestBackgroundTasks("session-retain", [{
        type: "backgroundTask.start",
        task: retainedTask
    }]);

    clearBackgroundTasks("session-delete");

    expect(backgroundTasksFor("session-delete")).toEqual([]);
    expect(backgroundTasksFor("session-retain").map((task) => task.id))
        .toEqual(["task-retain"]);
    clearBackgroundTasks("session-retain");
});

function snapshot(id: string, command: string): ToolTaskSnapshot {
    return {
        id,
        kind: "shell",
        command,
        cwd: "/tmp",
        output: "start\n",
        status: "running",
        exitCode: null,
        error: null,
        unreadCharacters: 0,
        truncatedCharacters: 0
    };
}

function state(snapshot: ToolTaskSnapshot, overrides: Partial<ToolTaskState>): ToolTaskState {
    const { output: _output, ...task } = snapshot;
    return { ...task, ...overrides };
}
