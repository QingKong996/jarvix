import {
    existsSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import type { LlmToolCallBlock } from "../llm/types.ts";
import {
    APPLY_PATCH_TOOL,
    ApplyPatchTool,
    createDefaultTools
} from "./index.ts";

test("applies add, update, move, and delete hunks", async () => {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-apply-patch-"));
    const tool = new ApplyPatchTool();
    try {
        writeFileSync(join(directory, "update.txt"), "foo\nbar\nbaz\nqux\n", "utf8");
        writeFileSync(join(directory, "delete.txt"), "remove me\n", "utf8");
        writeFileSync(join(directory, "old.txt"), "old\n", "utf8");

        const result = await tool.execute(call(directory, [
            "*** Begin Patch",
            "*** Add File: nested/added.txt",
            "+hello",
            "+world",
            "*** Update File: update.txt",
            "@@",
            " foo",
            "-bar",
            "+BAR",
            "@@",
            " baz",
            "-qux",
            "+QUX",
            "*** Update File: old.txt",
            "*** Move to: moved.txt",
            "@@",
            "-old",
            "+new",
            "*** Delete File: delete.txt",
            "*** End Patch"
        ]), { onOutput: () => undefined });

        expect(result.isError).toBe(false);
        expect(result.content).toBe([
            "Success. Updated the following files:",
            "A nested/added.txt",
            "M update.txt",
            "M moved.txt",
            "D delete.txt"
        ].join("\n"));
        expect(result.data).toMatchObject({
            kind: "apply_patch",
            status: "completed",
            output: result.content
        });
        expect(readFileSync(join(directory, "nested", "added.txt"), "utf8"))
            .toBe("hello\nworld\n");
        expect(readFileSync(join(directory, "update.txt"), "utf8"))
            .toBe("foo\nBAR\nbaz\nQUX\n");
        expect(readFileSync(join(directory, "moved.txt"), "utf8")).toBe("new\n");
        expect(existsSync(join(directory, "old.txt"))).toBe(false);
        expect(existsSync(join(directory, "delete.txt"))).toBe(false);
    } finally {
        tool.dispose();
        rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});

test("accepts heredoc input and preserves CRLF line endings", async () => {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-apply-patch-crlf-"));
    const tool = new ApplyPatchTool();
    try {
        writeFileSync(
            join(directory, "line-endings.txt"),
            "first\r\nold line\r\nlast\r\n",
            "utf8"
        );

        const result = await tool.execute(call(directory, [
            "<<'EOF'",
            "*** Begin Patch",
            "*** Update File: line-endings.txt",
            "@@",
            "-old line",
            "+new line",
            "+extra",
            "*** End Patch",
            "EOF"
        ]), { onOutput: () => undefined });

        expect(result.isError).toBe(false);
        expect(readFileSync(join(directory, "line-endings.txt"), "utf8"))
            .toBe("first\r\nnew line\r\nextra\r\nlast\r\n");
    } finally {
        tool.dispose();
        rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});

test("rejects a patch when its expected lines cannot be found", async () => {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-apply-patch-invalid-"));
    const tool = new ApplyPatchTool();
    try {
        const path = join(directory, "unchanged.txt");
        writeFileSync(path, "alpha\nbeta\n", "utf8");

        const result = await tool.execute(call(directory, [
            "*** Begin Patch",
            "*** Update File: unchanged.txt",
            "@@",
            "-missing",
            "+replacement",
            "*** End Patch"
        ]), { onOutput: () => undefined });

        expect(result.isError).toBe(true);
        expect(result.content).toContain("Failed to find expected lines");
        expect(readFileSync(path, "utf8")).toBe("alpha\nbeta\n");
    } finally {
        tool.dispose();
        rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});

test("registers apply_patch in the default tool set", () => {
    const tools = createDefaultTools();
    try {
        expect(tools.handles(APPLY_PATCH_TOOL)).toBe(true);
        expect(tools.definitions.map((definition) => definition.name))
            .toContain(APPLY_PATCH_TOOL);
    } finally {
        tools.dispose();
    }
});

function call(cwd: string, patchLines: string[]): LlmToolCallBlock {
    return {
        type: "toolCall",
        id: "call-apply-patch",
        name: APPLY_PATCH_TOOL,
        arguments: {
            patch: patchLines.join("\n"),
            cwd
        }
    };
}
