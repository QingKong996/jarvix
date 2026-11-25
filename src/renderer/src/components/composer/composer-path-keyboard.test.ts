import { expect, test } from "vitest";
import { pathCompletionKeyAction } from "./composer-path-keyboard.ts";

test("uses Tab to complete the active path text", () => {
    expect(pathCompletionKeyAction("Tab", false)).toBe("complete");
    expect(pathCompletionKeyAction("Tab", true)).toBe("previous");
});

test("keeps arrow navigation and Enter confirmation", () => {
    expect(pathCompletionKeyAction("ArrowUp", false)).toBe("previous");
    expect(pathCompletionKeyAction("ArrowDown", false)).toBe("next");
    expect(pathCompletionKeyAction("ArrowDown", true)).toBe("next");
    expect(pathCompletionKeyAction("Enter", false)).toBe("confirm");
    expect(pathCompletionKeyAction("Enter", true)).toBe("ignore");
});
