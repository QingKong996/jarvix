import { expect, test } from "vitest";
import {
    appendSandboxViolations,
    formatSandboxViolations
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
