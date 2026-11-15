import type { LlmToolCallBlock, LlmToolDefinition } from "../llm/types.ts";
import { ShellTool, type ShellSessionExit } from "./shell.ts";
import type {
    ToolBackgroundEndHandler,
    ToolExecutionResult,
    ToolExecutor,
    ToolOutputHandler
} from "./types.ts";
import {
    appendToolOutput,
    EXEC_COMMAND_TOOL,
    WRITE_STDIN_TOOL,
    type ToolCallOutputDelta,
    type ToolCallViewData
} from "./view.ts";

type BackgroundSubscription = {
    toolName: string;
    data: ToolCallViewData;
    onOutput: ToolOutputHandler;
    onBackgroundEnd?: ToolBackgroundEndHandler;
};

type BackgroundTask = {
    sessionId: string;
    subscriptions: BackgroundSubscription[];
    active: BackgroundSubscription | null;
    unwatch: (() => void) | null;
    ended: boolean;
};

/** Owns the shell tasks for one conversation and keeps their streams attached after timeouts. */
export class BackgroundTaskManager implements ToolExecutor {
    readonly definitions: readonly LlmToolDefinition[];
    private readonly shell: ShellTool;
    private readonly tasks = new Map<string, BackgroundTask>();

    constructor(shell = new ShellTool()) {
        this.shell = shell;
        this.definitions = shell.definitions;
    }

    handles(name: string): boolean {
        return this.shell.handles(name);
    }

    async execute(
        call: LlmToolCallBlock,
        onOutput: ToolOutputHandler,
        signal?: AbortSignal,
        onBackgroundEnd?: ToolBackgroundEndHandler
    ): Promise<ToolExecutionResult> {
        const result = await this.shell.execute(call, onOutput, signal);
        if (result.taskId) {
            this.attach(result.taskId, call.name, onOutput, result.data, onBackgroundEnd);
        }
        return result;
    }

    dispose(): void {
        for (const task of this.tasks.values()) {
            task.unwatch?.();
        }
        this.tasks.clear();
        this.shell.dispose();
    }

    private attach(
        sessionId: string,
        toolName: string,
        onOutput: ToolOutputHandler,
        initialData: ToolCallViewData,
        onBackgroundEnd?: ToolBackgroundEndHandler
    ): void {
        const subscription: BackgroundSubscription = {
            toolName,
            data: initialData,
            onOutput,
            onBackgroundEnd
        };
        const existing = this.tasks.get(sessionId);
        if (existing) {
            existing.subscriptions.push(subscription);
            existing.active = subscription;
            return;
        }

        const task: BackgroundTask = {
            sessionId,
            subscriptions: [subscription],
            active: subscription,
            unwatch: null,
            ended: false
        };
        this.tasks.set(sessionId, task);
        const unwatch = this.shell.watchSession(sessionId, (chunk) => {
            const active = task.active;
            if (!active) {
                return;
            }
            const delta = outputDelta(active.toolName, chunk);
            active.data = appendToolOutput(active.data, delta);
            active.onOutput(delta);
        }, (exit) => {
            this.finish(task, exit);
        });
        if (task.ended) {
            unwatch();
        } else {
            task.unwatch = unwatch;
        }
    }

    private finish(task: BackgroundTask, exit: ShellSessionExit): void {
        if (task.ended) {
            return;
        }
        task.ended = true;
        task.unwatch?.();
        task.unwatch = null;
        task.active = null;
        this.tasks.delete(task.sessionId);

        const isError = Boolean(exit.error) || exit.exitCode !== 0;
        for (const subscription of task.subscriptions) {
            const completed: ToolCallViewData = {
                ...subscription.data,
                status: isError ? "failed" : "completed"
            };
            setTimeout(() => {
                subscription.onBackgroundEnd?.({
                    taskId: task.sessionId,
                    exitCode: exit.exitCode,
                    error: exit.error,
                    unreadOutput: exit.unreadOutput,
                    data: completed,
                    isError
                });
            }, 0);
        }
    }
}

function outputDelta(toolName: string, output: string): ToolCallOutputDelta {
    switch (toolName) {
        case EXEC_COMMAND_TOOL:
            return { kind: "shell.exec_command", output };
        case WRITE_STDIN_TOOL:
            return { kind: "shell.write_stdin", output };
        default:
            return { kind: "generic", output };
    }
}

