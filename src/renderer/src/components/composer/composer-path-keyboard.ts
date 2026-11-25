export type PathCompletionKeyAction =
    | "complete"
    | "confirm"
    | "previous"
    | "next"
    | "ignore";

export function pathCompletionKeyAction(
    key: string,
    shiftKey: boolean
): PathCompletionKeyAction {
    if (key === "Tab") {
        return shiftKey ? "previous" : "complete";
    }
    if (key === "ArrowUp") {
        return "previous";
    }
    if (key === "ArrowDown") {
        return "next";
    }
    if (key === "Enter") {
        return shiftKey ? "ignore" : "confirm";
    }
    return "ignore";
}
