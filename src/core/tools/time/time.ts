import { z } from "zod";
import type { LlmToolCallBlock, LlmToolDefinition } from "../../../llm/types.ts";
import type {
    ToolExecutionObserver,
    ToolExecutionResult,
    ToolExecutor,
    ToolStopEvent
} from "../shared/types.ts";
import {
    LOCAL_TIME_TOOL,
    SLEEP_TOOL,
    type LocalTimeView,
    type SleepView
} from "./view.ts";

export { LOCAL_TIME_TOOL, SLEEP_TOOL };

const localTimeArguments = z.object({}).strict();
const sleepArguments = z.object({
    durationMs: z.number().int().min(1).max(2_147_483_647)
});

export const LOCAL_TIME_TOOL_DEFINITIONS: readonly LlmToolDefinition[] = [{
    name: LOCAL_TIME_TOOL,
    description: "Return the current local time, time zone, UTC offset, and Unix timestamp in milliseconds.",
    parameters: {
        type: "object",
        properties: {},
        additionalProperties: false
    }
}];

export const SLEEP_TOOL_DEFINITIONS: readonly LlmToolDefinition[] = [{
    name: SLEEP_TOOL,
    description: [
        "Pause the current agent loop for durationMs milliseconds.",
        "The tool completes only after the delay; it does not run in the background."
    ].join(" "),
    parameters: {
        type: "object",
        properties: {
            durationMs: {
                type: "integer",
                minimum: 1,
                maximum: 2_147_483_647,
                description: "Time to wait in milliseconds."
            }
        },
        required: ["durationMs"],
        additionalProperties: false
    }
}];

/** Returns the host machine's current local time. */
export class LocalTimeTool implements ToolExecutor {
    readonly definitions = LOCAL_TIME_TOOL_DEFINITIONS;

    handles(name: string): boolean {
        return name === LOCAL_TIME_TOOL;
    }

    async execute(
        call: LlmToolCallBlock,
        _observer: ToolExecutionObserver
    ): Promise<ToolExecutionResult> {
        const parsed = localTimeArguments.safeParse(call.arguments);
        if (!parsed.success) {
            const content = `Invalid arguments for ${call.name}: ${parsed.error.message}`;
            return localTimeResult(content, "failed", {
                localTime: "",
                timeZone: "",
                utcOffset: "",
                epochMillis: 0
            });
        }

        const now = new Date();
        const utcOffset = formatUtcOffset(now);
        const value = {
            localTime: formatLocalIso(now, utcOffset),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            utcOffset,
            epochMillis: now.getTime()
        };
        return localTimeResult(JSON.stringify(value, null, 2), "completed", value);
    }

    dispose(): void {
        // No resources to release.
    }

    async stop(): Promise<readonly ToolStopEvent[]> {
        return [];
    }
}

/** Blocks the current tool execution until the requested delay finishes or is aborted. */
export class SleepTool implements ToolExecutor {
    readonly definitions = SLEEP_TOOL_DEFINITIONS;

    handles(name: string): boolean {
        return name === SLEEP_TOOL;
    }

    async execute(
        call: LlmToolCallBlock,
        _observer: ToolExecutionObserver,
        signal?: AbortSignal
    ): Promise<ToolExecutionResult> {
        const parsed = sleepArguments.safeParse(call.arguments);
        if (!parsed.success) {
            return sleepResult(
                typeof call.arguments.durationMs === "number" ? call.arguments.durationMs : 0,
                Date.now(),
                0,
                `Invalid arguments for ${call.name}: ${parsed.error.message}`,
                "failed"
            );
        }
        const { durationMs } = parsed.data;
        if (signal?.aborted) {
            return sleepResult(durationMs, Date.now(), 0, "Sleep interrupted after 0 ms.", "failed");
        }

        const startedAt = Date.now();
        const outcome = await waitForDelay(durationMs, signal);
        const elapsedMs = Date.now() - startedAt;
        if (outcome === "aborted") {
            return sleepResult(
                durationMs,
                startedAt,
                elapsedMs,
                `Sleep interrupted after ${elapsedMs} ms.`,
                "failed"
            );
        }
        return sleepResult(durationMs, startedAt, durationMs, `Slept for ${durationMs} ms.`, "completed");
    }

    dispose(): void {
        // No resources to release.
    }

    async stop(): Promise<readonly ToolStopEvent[]> {
        return [];
    }
}

function waitForDelay(durationMs: number, signal?: AbortSignal): Promise<"completed" | "aborted"> {
    return new Promise((resolvePromise) => {
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", abort);
            resolvePromise("completed");
        }, durationMs);
        const abort = (): void => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", abort);
            resolvePromise("aborted");
        };
        signal?.addEventListener("abort", abort, { once: true });
    });
}

function formatLocalIso(date: Date, utcOffset: string): string {
    return [
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
        `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`,
        utcOffset
    ].join("");
}

function formatUtcOffset(date: Date): string {
    const offsetMinutes = -date.getTimezoneOffset();
    const sign = offsetMinutes < 0 ? "-" : "+";
    const absoluteOffset = Math.abs(offsetMinutes);
    return `${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`;
}

function pad(value: number, length = 2): string {
    return String(value).padStart(length, "0");
}

function localTimeResult(
    content: string,
    status: LocalTimeView["status"],
    value: Omit<LocalTimeView, "kind" | "output" | "status">
): ToolExecutionResult {
    const data: LocalTimeView = {
        kind: "time.local_time",
        ...value,
        output: content,
        status
    };
    return {
        content,
        data,
        isError: status === "failed",
        endReason: "exited"
    };
}

function sleepResult(
    durationMs: number,
    startedAt: number,
    elapsedMs: number,
    content: string,
    status: SleepView["status"]
): ToolExecutionResult {
    const data: SleepView = {
        kind: "time.sleep",
        durationMs,
        startedAt,
        elapsedMs,
        output: content,
        status
    };
    return {
        content,
        data,
        isError: status === "failed",
        endReason: "exited"
    };
}
