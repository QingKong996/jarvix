import {
    numberArgument,
    type ToolCallStatus
} from "../shared/view.ts";

export const LOCAL_TIME_TOOL = "get_local_time";
export const SLEEP_TOOL = "sleep";

export type LocalTimeView = {
    kind: "time.local_time";
    localTime: string;
    timeZone: string;
    utcOffset: string;
    epochMillis: number;
    output: string;
    status: ToolCallStatus;
};

export type SleepView = {
    kind: "time.sleep";
    durationMs: number;
    startedAt: number;
    elapsedMs: number;
    output: string;
    status: ToolCallStatus;
};

export type TimeToolCallViewData = LocalTimeView | SleepView;

export function createTimeToolCallViewData(
    name: string,
    arguments_: Record<string, unknown>,
    status: ToolCallStatus = "pending"
): TimeToolCallViewData | null {
    if (name === LOCAL_TIME_TOOL) {
        return {
            kind: "time.local_time",
            localTime: "",
            timeZone: "",
            utcOffset: "",
            epochMillis: 0,
            output: "",
            status
        };
    }
    if (name === SLEEP_TOOL) {
        return {
            kind: "time.sleep",
            durationMs: numberArgument(arguments_.durationMs),
            startedAt: Date.now(),
            elapsedMs: 0,
            output: "",
            status
        };
    }
    return null;
}

export function isTimeToolCallViewData(value: Record<string, unknown>): boolean {
    if (value.kind === "time.local_time") {
        return typeof value.localTime === "string"
            && typeof value.timeZone === "string"
            && typeof value.utcOffset === "string"
            && typeof value.epochMillis === "number";
    }
    if (value.kind === "time.sleep") {
        return typeof value.durationMs === "number"
            && typeof value.startedAt === "number"
            && typeof value.elapsedMs === "number";
    }
    return false;
}
