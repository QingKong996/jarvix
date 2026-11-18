import { expect, test } from "vitest";
import {
    appendSandboxViolations,
    formatSandboxViolations,
    rememberSandboxViolation,
    SANDBOX_VIOLATION_TRACKING_LIMIT
} from "./violations.ts";

test("formats violations as one safe envelope", () => {
    expect(formatSandboxViolations(["denied <write>\nnext"]))
        .toBe([
            "<sandbox_violations>",
            "denied write next",
            "</sandbox_violations>"
        ].join("\n"));
});

test("appends violations without changing ordinary output", () => {
    expect(appendSandboxViolations("", ["blocked"]))
        .toBe("<sandbox_violations>\nblocked\n</sandbox_violations>");
    expect(appendSandboxViolations("output", []))
        .toBe("output");
});

test("bounds remembered violation signatures", () => {
    const seen = new Set<string>();
    for (let index = 0; index < SANDBOX_VIOLATION_TRACKING_LIMIT + 25; index += 1) {
        expect(rememberSandboxViolation(seen, `blocked-${index}`)).toBe(true);
    }

    expect(seen.size).toBe(SANDBOX_VIOLATION_TRACKING_LIMIT);
    expect(rememberSandboxViolation(seen, "blocked-5")).toBe(true);
    expect(rememberSandboxViolation(seen, "blocked-5")).toBe(false);
    expect(seen.size).toBe(SANDBOX_VIOLATION_TRACKING_LIMIT);
});
