export type ToolCallStatus = "pending" | "running" | "completed" | "timed_out" | "failed";

export type GenericToolView = {
    kind: "generic";
    name: string;
    arguments: Record<string, unknown>;
    output: string;
    status: ToolCallStatus;
};

type ToolCallViewBase = {
    kind: string;
    output: string;
    status: ToolCallStatus;
};

export function createGenericToolCallViewData(
    name: string,
    arguments_: Record<string, unknown>,
    status: ToolCallStatus = "pending"
): GenericToolView {
    return {
        kind: "generic",
        name,
        arguments: arguments_,
        output: "",
        status
    };
}

export function isToolCallViewBase(
    value: unknown
): value is Record<string, unknown> & ToolCallViewBase {
    return isRecord(value)
        && typeof value.kind === "string"
        && isToolCallStatus(value.status)
        && typeof value.output === "string";
}

export function stringArgument(value: unknown): string {
    return typeof value === "string" ? value : "";
}

export function numberArgument(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isToolCallStatus(value: unknown): value is ToolCallStatus {
    return value === "pending"
        || value === "running"
        || value === "completed"
        || value === "timed_out"
        || value === "failed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
