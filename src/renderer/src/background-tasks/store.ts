import { useSyncExternalStore } from "react";
import type { JarvixEvent } from "../../../protocol/event.ts";
import type { ToolTaskSnapshot } from "../../../core/tools/types.ts";
import { appendBoundedOutput } from "../../../core/tools/output.ts";

const EMPTY_TASKS: readonly ToolTaskSnapshot[] = [];
const listeners = new Set<() => void>();
let tasksBySession = new Map<string, readonly ToolTaskSnapshot[]>();

/** Apply only live background-task events. Persisted session history intentionally restores none. */
export function reduceBackgroundTasks(
    tasks: readonly ToolTaskSnapshot[],
    events: readonly JarvixEvent[]
): readonly ToolTaskSnapshot[] {
    let next = tasks;
    for (const event of events) {
        switch (event.type) {
            case "backgroundTask.start": {
                const index = next.findIndex((task) => task.id === event.task.id);
                next = index === -1
                    ? [...next, event.task]
                    : next.map((task) => task.id === event.task.id ? event.task : task);
                break;
            }
            case "backgroundTask.output":
                next = next.map((task) => (
                    task.id === event.taskId && task.status === "running"
                        ? {
                            ...task,
                            output: appendBoundedOutput(task.output, event.output),
                            truncatedCharacters: Math.max(
                                task.truncatedCharacters,
                                event.truncatedCharacters
                            )
                        }
                        : task
                ));
                break;
            case "backgroundTask.end":
            case "backgroundTask.consume":
                next = next.flatMap((task) => {
                    if (task.id !== event.task.id) {
                        return [task];
                    }
                    const updated = { ...task, ...event.task };
                    if (updated.status !== "running" && updated.unreadCharacters === 0) {
                        return [];
                    }
                    return [updated];
                });
                break;
            default:
                break;
        }
    }
    return next;
}

export function ingestBackgroundTasks(sessionId: string, events: readonly JarvixEvent[]): void {
    const current = tasksBySession.get(sessionId) ?? EMPTY_TASKS;
    const next = reduceBackgroundTasks(current, events);
    if (next === current) {
        return;
    }

    tasksBySession = new Map(tasksBySession);
    if (next.length === 0) {
        tasksBySession.delete(sessionId);
    } else {
        tasksBySession.set(sessionId, next);
    }
    for (const listener of listeners) {
        listener();
    }
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function useBackgroundTasks(sessionId: string | null): readonly ToolTaskSnapshot[] {
    return useSyncExternalStore(
        subscribe,
        () => sessionId ? tasksBySession.get(sessionId) ?? EMPTY_TASKS : EMPTY_TASKS,
        () => EMPTY_TASKS
    );
}
