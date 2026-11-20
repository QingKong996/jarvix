import type { LlmToolCallBlock, LlmToolDefinition } from "../../../llm/types.ts";
import { appendSandboxViolations } from "../../permissions/violations.ts";
import {
    ShellTool,
    type ShellSessionBudget,
    type ShellSessionExit
} from "./shell.ts";
import type {
    ToolBackgroundEndHandler,
    ToolExecutionResult,
    ToolExecutionObserver,
    ToolExecutor,
    ToolStopEvent,
    ToolTaskEventHandler,
    ToolTaskState,
    ToolTaskSnapshot
} from "../shared/types.ts";
import {
    EXEC_COMMAND_TOOL,
    WRITE_STDIN_TOOL
} from "./view.ts";
import type { ToolCallViewData } from "../view.ts";

export const MAX_BACKGROUND_SUBSCRIPTIONS = 32;

type BackgroundSubscription = {
    toolCallId: string;
    toolName: string;
    data: ToolCallViewData;
    onBackgroundEnd?: ToolBackgroundEndHandler;
};

type BackgroundTask = {
    state: ToolTaskState;
    subscriptions: BackgroundSubscription[];
    unwatch: (() => void) | null;
    onTaskEvent?: ToolTaskEventHandler;
};

/** Owns the shell tasks for one conversation and broadcasts their output separately from tool calls. */
export class BackgroundTaskManager implements ToolExecutor {
    readonly definitions: readonly LlmToolDefinition[];
    private readonly shell: ShellTool;
    private readonly retentionBudget?: ShellSessionBudget;
    private readonly tasks = new Map<string, BackgroundTask>();

    constructor(shell = new ShellTool()) {
        this.shell = shell;
        this.retentionBudget = shell.sharedBudget;
        this.definitions = shell.definitions;
    }

    handles(name: string): boolean {
        return this.shell.handles(name);
    }

    hasActiveWork(): boolean {
        return this.tasks.size > 0;
    }

    async execute(
        call: LlmToolCallBlock,
        observer: ToolExecutionObserver,
        signal?: AbortSignal
    ): Promise<ToolExecutionResult> {
        const result = await this.shell.execute(call, observer, signal);
        if (result.task) {
            const task = this.tasks.get(result.task.id);
            if (call.name === EXEC_COMMAND_TOOL && !task) {
                this.startTask(result.task, call, result.data, observer);
            } else if (call.name === WRITE_STDIN_TOOL && task) {
                if (task.state.status === "running") {
                    task.subscriptions.push({
                        toolCallId: call.id,
                        toolName: call.name,
                        data: result.data,
                        onBackgroundEnd: observer.onBackgroundEnd
                    });
                    if (task.subscriptions.length > MAX_BACKGROUND_SUBSCRIPTIONS) {
                        task.subscriptions.splice(
                            0,
                            task.subscriptions.length - MAX_BACKGROUND_SUBSCRIPTIONS
                        );
                    }
                }
                this.consumeTask(task, result.task, observer.onTaskEvent);
            }
        }
        return result;
    }

    async stop(): Promise<readonly ToolStopEvent[]> {
        const active = [...this.tasks.values()].filter(
            (task) => task.state.status === "running"
        );
        for (const task of active) {
            task.unwatch?.();
            task.unwatch = null;
            task.onTaskEvent = undefined;
        }

        const exits = await this.shell.stopAll();
        const exitBySession = new Map(exits.map((exit) => [exit.sessionId, exit]));
        const events: ToolStopEvent[] = [];

        for (const task of active) {
            const exit = exitBySession.get(task.state.id);
            const error = exit?.error
                ?? (exit ? null : "Process state was unavailable during shutdown.");
            const exitCode = exit?.exitCode ?? null;
            const violations = exit?.violations ?? [];
            const intercepted = exit?.intercepted ?? false;
            const unreadOutput = appendSandboxViolations(exit?.unreadOutput ?? "", violations);
            const state: ToolTaskState = {
                ...task.state,
                status: error || exitCode !== 0 || intercepted ? "failed" : "completed",
                exitCode,
                error,
                unreadCharacters: unreadOutput.length,
                truncatedCharacters: exit?.truncatedCharacters ?? task.state.truncatedCharacters
            };
            task.state = state;
            events.push({ type: "backgroundTask.end", task: state });

            for (const subscription of task.subscriptions.splice(0)) {
                const failed = state.status === "failed";
                events.push({
                    type: "tool.end",
                    toolCallId: subscription.toolCallId,
                    toolName: subscription.toolName,
                    data: withViolations(
                        {
                            ...subscription.data,
                            status: failed ? "failed" : "completed"
                        },
                        violations
                    ),
                    isError: failed,
                    endReason: "terminated"
                });
            }
            this.shell.releaseSession(task.state.id);
        }

        this.tasks.clear();
        return events;
    }

    dispose(): void {
        for (const task of this.tasks.values()) {
            task.unwatch?.();
        }
        this.tasks.clear();
        this.shell.dispose();
    }

    private startTask(
        snapshot: ToolTaskSnapshot,
        call: LlmToolCallBlock,
        data: ToolCallViewData,
        observer: ToolExecutionObserver
    ): void {
        const task: BackgroundTask = {
            state: taskState(snapshot),
            subscriptions: [{
                toolCallId: call.id,
                toolName: call.name,
                data,
                onBackgroundEnd: observer.onBackgroundEnd
            }],
            unwatch: null,
            onTaskEvent: observer.onTaskEvent
        };
        this.tasks.set(snapshot.id, task);
        observer.onTaskEvent?.({ type: "backgroundTask.start", task: snapshot });

        const unwatch = this.shell.watchSession(snapshot.id, (chunk, truncatedCharacters) => {
            task.state = { ...task.state, truncatedCharacters };
            task.onTaskEvent?.({
                type: "backgroundTask.output",
                taskId: task.state.id,
                output: chunk,
                truncatedCharacters
            });
        }, (exit) => {
            this.finish(task, exit);
        });
        if (task.state.status === "running") {
            task.unwatch = unwatch;
        } else {
            unwatch();
        }
    }

    private consumeTask(
        task: BackgroundTask,
        snapshot: ToolTaskSnapshot,
        onTaskEvent?: ToolTaskEventHandler
    ): void {
        task.state = taskState(snapshot);
        task.onTaskEvent = onTaskEvent ?? task.onTaskEvent;
        task.onTaskEvent?.({ type: "backgroundTask.consume", task: task.state });
        if (task.state.status !== "running" && task.state.unreadCharacters === 0) {
            this.dropTask(task);
        }
    }

    private finish(task: BackgroundTask, exit: ShellSessionExit): void {
        if (task.state.status !== "running") {
            return;
        }
        task.unwatch?.();
        task.unwatch = null;
        const unreadOutput = appendSandboxViolations(exit.unreadOutput, exit.violations);
        task.state = {
            ...task.state,
            status: exit.error || exit.exitCode !== 0 || exit.intercepted ? "failed" : "completed",
            exitCode: exit.exitCode,
            error: exit.error,
            unreadCharacters: unreadOutput.length,
            truncatedCharacters: exit.truncatedCharacters
        };
        task.onTaskEvent?.({ type: "backgroundTask.end", task: task.state });

        const subscriptions = task.subscriptions.splice(0);
        const isError = task.state.status === "failed";
        for (const subscription of subscriptions) {
            const completed: ToolCallViewData = withViolations(
                {
                    ...subscription.data,
                    status: isError ? "failed" : "completed"
                },
                exit.violations
            );
            setTimeout(() => {
                subscription.onBackgroundEnd?.({
                    taskId: task.state.id,
                    exitCode: task.state.exitCode,
                    error: task.state.error,
                    unreadOutput,
                    data: completed,
                    isError
                });
            }, 0);
        }

        if (task.state.unreadCharacters === 0) {
            this.dropTask(task);
        } else {
            this.retentionBudget?.registerReclaimable(task.state.id, () => {
                this.discardTask(task);
            });
        }
    }

    private discardTask(task: BackgroundTask): void {
        if (!this.tasks.has(task.state.id)) {
            return;
        }
        task.onTaskEvent?.({ type: "backgroundTask.discard", task: task.state });
        this.dropTask(task);
    }

    private dropTask(task: BackgroundTask): void {
        task.unwatch?.();
        task.unwatch = null;
        this.retentionBudget?.unregisterReclaimable(task.state.id);
        this.tasks.delete(task.state.id);
        this.shell.releaseSession(task.state.id);
    }
}

function taskState(snapshot: ToolTaskSnapshot): ToolTaskState {
    const { output: _output, ...state } = snapshot;
    return state;
}

function withViolations(
    data: ToolCallViewData,
    violations: readonly string[]
): ToolCallViewData {
    const output = appendSandboxViolations(data.output, violations);
    return output === data.output ? data : { ...data, output };
}
