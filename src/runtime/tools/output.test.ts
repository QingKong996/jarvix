import { expect, test } from "vitest";
import {
    appendBoundedOutput,
    formatTruncatedOutput,
    MAX_TOOL_OUTPUT_CHARS,
    OUTPUT_TRUNCATION_NOTICE
} from "./output.ts";

test.each([
    ["empty chunk", ""],
    ["one character", "x"],
    ["notice-sized chunk", "x".repeat(OUTPUT_TRUNCATION_NOTICE.length)]
])("keeps bounded output unchanged when %s fits", (_label, chunk) => {
    const output = "x".repeat(MAX_TOOL_OUTPUT_CHARS - chunk.length);

    expect(appendBoundedOutput(output, chunk)).toBe(output + chunk);
});

test("keeps exactly the newest output when the limit is exceeded", () => {
    const suffix = "LATEST";
    const result = appendBoundedOutput(
        "discarded",
        "x".repeat(MAX_TOOL_OUTPUT_CHARS) + suffix
    );

    expect(result).toHaveLength(MAX_TOOL_OUTPUT_CHARS);
    expect(result.startsWith(OUTPUT_TRUNCATION_NOTICE)).toBe(true);
    expect(result.endsWith(suffix)).toBe(true);
    expect(result).not.toContain("discarded");
});

test("does not split a surrogate pair at the truncation boundary", () => {
    const prefixLength = OUTPUT_TRUNCATION_NOTICE.length + 2;
    const prefix = "a".repeat(prefixLength);
    const suffix = "b".repeat(MAX_TOOL_OUTPUT_CHARS - OUTPUT_TRUNCATION_NOTICE.length - 1);

    const result = appendBoundedOutput("", `${prefix}😀${suffix}`);

    expect(result).toHaveLength(MAX_TOOL_OUTPUT_CHARS - 1);
    expect(result.isWellFormed()).toBe(true);
});

test("formats discarded output only when characters were omitted", () => {
    expect(formatTruncatedOutput("tail", 0)).toBe("tail");
    expect(formatTruncatedOutput("tail", 5)).toBe(
        `${OUTPUT_TRUNCATION_NOTICE}`
        + `[5 earlier characters were discarded; only the latest ${MAX_TOOL_OUTPUT_CHARS} characters are retained.]\n`
        + "tail"
    );
});
