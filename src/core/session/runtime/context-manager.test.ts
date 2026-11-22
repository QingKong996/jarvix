import { expect, test } from "vitest";
import { DefaultContextManager } from "./context-manager.ts";

test("keeps environment state isolated between context managers", () => {
    const first = new DefaultContextManager(() => "read-only");
    const second = new DefaultContextManager(() => "read-only");
    first.initializeHistory([]);
    second.initializeHistory([]);
    first.ensureEnvironmentContext(["C:\\first"]);
    second.ensureEnvironmentContext(["C:\\second"]);

    expect(first.environmentReminderIfChanged(["C:\\second"])).not.toBeNull();
    expect(second.environmentReminderIfChanged(["C:\\second"])).toBeNull();
});
