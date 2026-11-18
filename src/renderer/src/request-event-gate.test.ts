import { expect, test } from "vitest";
import type { JarvixEvent } from "../../protocol/event.ts";
import { RequestEventGate } from "./request-event-gate.ts";

const events: JarvixEvent[] = [
    { type: "text.delta", index: 0, delta: "late text" },
    {
        type: "tool.end",
        toolCallId: "call-1",
        toolName: "exec_command",
        data: {
            kind: "shell.exec_command",
            command: "echo hi",
            output: "hi\n",
            status: "completed"
        },
        isError: false,
        endReason: "exited"
    }
];

test("drops ordinary events after a stop but keeps tool results", () => {
    const gate = new RequestEventGate();
    gate.pause("session-1");

    expect(gate.filter("session-1", events)).toEqual([events[1]]);
});

test("keeps background task activity and completion notices after a stop", () => {
    const gate = new RequestEventGate();
    gate.pause("session-1");
    const task = {
        id: "task-1",
        kind: "shell" as const,
        command: "long task",
        cwd: "/tmp",
        output: "output\n",
        status: "running" as const,
        exitCode: null,
        error: null,
        unreadCharacters: 0
    };
    const backgroundEvents: JarvixEvent[] = [
        { type: "backgroundTask.start", task },
        { type: "backgroundTask.output", taskId: task.id, output: "more\n" },
        {
            type: "backgroundTask.end",
            task: {
                ...task,
                status: "completed",
                exitCode: 0
            }
        },
        {
            type: "system.message",
            message: {
                role: "system",
                content: "Background task exited.",
                timestamp: 1,
                notice: {
                    kind: "background.task_exit",
                    sessionId: task.id,
                    exitCode: 0,
                    errorMessage: null,
                    unreadCharacters: 7
                }
            }
        },
        { type: "text.delta", index: 0, delta: "late text" }
    ];

    expect(gate.filter("session-1", backgroundEvents)).toEqual(
        backgroundEvents.slice(0, -1)
    );
});

test("keeps a session rename after a stop", () => {
    const gate = new RequestEventGate();
    gate.pause("session-1");

    expect(gate.filter("session-1", [{
        type: "session.renamed",
        name: "Renamed"
    }])).toEqual([{ type: "session.renamed", name: "Renamed" }]);
});

test("waits for the next request start before forwarding ordinary events", () => {
    const gate = new RequestEventGate();
    gate.pause("session-1");
    gate.resume("session-1");

    expect(gate.filter("session-1", events)).toEqual([events[1]]);
    expect(gate.filter("session-1", [
        { type: "start" },
        { type: "text.delta", index: 0, delta: "new" }
    ])).toEqual([
        { type: "start" },
        { type: "text.delta", index: 0, delta: "new" }
    ]);
    expect(gate.filter("session-1", events)).toEqual(events);
});

test("does not gate a session without a paused request", () => {
    const gate = new RequestEventGate();

    expect(gate.filter("session-1", events)).toEqual(events);
});

test("stops filtering when a stop request fails", () => {
    const gate = new RequestEventGate();
    gate.pause("session-1");
    gate.cancelPause("session-1");

    expect(gate.filter("session-1", events)).toEqual(events);
});
