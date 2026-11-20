import {
    existsSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    truncateSync,
    writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import type { LlmToolCallBlock } from "../../../llm/types.ts";
import { createSandboxPolicy } from "../../permissions/sandbox.ts";
import { createDefaultTools } from "../index.ts";
import { APPLY_PATCH_TOOL, ApplyPatchTool } from "./apply-patch.ts";

test("rejects updates to files above the safe size limit", async () => {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-apply-patch-large-"));
    const tool = new ApplyPatchTool();
    const file = join(directory, "large.txt");
    try {
        writeFileSync(file, "old\n", "utf8");
        truncateSync(file, 16 * 1024 * 1024 + 1);

        const result = await tool.execute(call(directory, [
            "*** Begin Patch",
            "*** Update File: large.txt",
            "@@",
            "-old",
            "+new",
            "*** End Patch"
        ]), { onOutput: () => undefined });

        expect(result.isError).toBe(true);
        expect(result.content).toContain("exceeds the 16.0 MiB limit");
    } finally {
        tool.dispose();
        rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});

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

test("validates every hunk before changing any file", async () => {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-apply-patch-preflight-"));
    const tool = new ApplyPatchTool();
    try {
        const first = join(directory, "first.txt");
        const second = join(directory, "second.txt");
        writeFileSync(first, "old first\n", "utf8");
        writeFileSync(second, "untouched\n", "utf8");

        const result = await tool.execute(call(directory, [
            "*** Begin Patch",
            "*** Update File: first.txt",
            "@@",
            "-old first",
            "+new first",
            "*** Update File: second.txt",
            "@@",
            "-missing",
            "+replacement",
            "*** End Patch"
        ]), { onOutput: () => undefined });

        expect(result.isError).toBe(true);
        expect(result.content).toContain("Failed to find expected lines");
        expect(readFileSync(first, "utf8")).toBe("old first\n");
        expect(readFileSync(second, "utf8")).toBe("untouched\n");
    } finally {
        tool.dispose();
        rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});

test("spools prepared updates instead of retaining every file body", async () => {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-apply-patch-spooled-"));
    const tool = new ApplyPatchTool();
    const controller = new AbortController();
    const existingSpools = new Set(applyPatchSpoolDirectories());
    let pending: ReturnType<ApplyPatchTool["execute"]> | undefined;
    try {
        const first = join(directory, "first.txt");
        const second = join(directory, "second.txt");
        writeFileSync(first, "old first\n", "utf8");
        writeFileSync(second, "old second\n", "utf8");

        pending = tool.execute(call(directory, [
            "*** Begin Patch",
            "*** Update File: first.txt",
            "@@",
            "-old first",
            "+new first",
            "*** Update File: second.txt",
            "@@",
            "-old second",
            "+new second",
            "*** End Patch"
        ]), { onOutput: () => undefined }, controller.signal);

        const createdSpools = applyPatchSpoolDirectories()
            .filter((path) => !existingSpools.has(path));
        expect(createdSpools).toHaveLength(1);
        const spoolDirectory = createdSpools[0]!;
        expect(readdirSync(spoolDirectory).sort()).toEqual(["0.bin", "1.bin"]);
        const preparedContents = readdirSync(spoolDirectory)
            .map((name) => readFileSync(join(spoolDirectory, name), "utf8"))
            .sort();
        expect(preparedContents).toEqual(["new first\n", "new second\n"]);
        expect(readFileSync(first, "utf8")).toBe("old first\n");
        expect(readFileSync(second, "utf8")).toBe("old second\n");

        controller.abort();
        const result = await pending;
        pending = undefined;

        expect(result.isError).toBe(true);
        expect(result.content).toContain("No changes were applied");
        expect(readFileSync(first, "utf8")).toBe("old first\n");
        expect(readFileSync(second, "utf8")).toBe("old second\n");
        expect(existsSync(spoolDirectory)).toBe(false);
    } finally {
        controller.abort();
        if (pending) {
            await pending.catch(() => undefined);
        }
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

test("stops before applying files when cancelled", async () => {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-apply-patch-abort-"));
    const tool = new ApplyPatchTool();
    const controller = new AbortController();
    try {
        const pending = tool.execute(call(directory, [
            "*** Begin Patch",
            "*** Add File: aborted.txt",
            "+not written",
            "*** End Patch"
        ]), { onOutput: () => undefined }, controller.signal);
        controller.abort();

        const result = await pending;

        expect(result.isError).toBe(true);
        expect(result.content).toContain("Apply patch stopped");
        expect(existsSync(join(directory, "aborted.txt"))).toBe(false);
    } finally {
        tool.dispose();
        rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});

test("returns completed changes when cancelled between file hunks", async () => {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-apply-patch-partial-"));
    const tool = new ApplyPatchTool();
    const controller = new AbortController();
    try {
        const pending = tool.execute(call(directory, [
            "*** Begin Patch",
            "*** Add File: first.txt",
            "+first",
            "*** Add File: second.txt",
            "+second",
            "*** End Patch"
        ]), { onOutput: () => undefined }, controller.signal);
        setTimeout(() => controller.abort(), 0);

        const result = await pending;

        expect(result.isError).toBe(true);
        expect(result.content).toContain("A first.txt");
        expect(result.content).toContain("Changes applied before stopping:");
        expect(result.content).not.toContain("Success.");
        expect(result.content).not.toContain("second.txt");
        expect(existsSync(join(directory, "first.txt"))).toBe(true);
        expect(existsSync(join(directory, "second.txt"))).toBe(false);
    } finally {
        tool.dispose();
        rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});

test("rejects apply_patch writes in read-only mode", async () => {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-apply-patch-readonly-"));
    const tool = new ApplyPatchTool({
        sandboxPolicy: () => createSandboxPolicy("read-only", [directory])
    });
    try {
        const result = await tool.execute(call(directory, [
            "*** Begin Patch",
            "*** Add File: blocked.txt",
            "+blocked",
            "*** End Patch"
        ]), { onOutput: () => undefined });

        expect(result).toMatchObject({
            isError: true,
            data: {
                kind: "apply_patch",
                status: "failed"
            }
        });
        expect(result.content).toContain("<sandbox_violations>");
        expect(result.content).toContain("(invocation call-apply-patch)");
        expect(result.content).toContain("no writable roots");
        expect(existsSync(join(directory, "blocked.txt"))).toBe(false);
    } finally {
        tool.dispose();
        rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});

test("checks every apply_patch target before writing any file", async () => {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-apply-patch-targets-"));
    const tool = new ApplyPatchTool({
        sandboxPolicy: () => createSandboxPolicy("project-read-write", [directory])
    });
    const outside = join(directory, "..", `jarvix-outside-${Date.now()}.txt`);
    try {
        const result = await tool.execute(call(directory, [
            "*** Begin Patch",
            "*** Add File: allowed.txt",
            "+allowed",
            `*** Add File: ../${outside.split(/[\\/]/).at(-1)}`,
            "+outside",
            "*** End Patch"
        ]), { onOutput: () => undefined });

        expect(result.isError).toBe(true);
        expect(result.content).toContain("outside sandbox allowWrite roots");
        expect(existsSync(join(directory, "allowed.txt"))).toBe(false);
        expect(existsSync(outside)).toBe(false);
    } finally {
        tool.dispose();
        rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});

test("rejects an apply_patch move whose destination is outside the workspace", async () => {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-apply-patch-move-"));
    const source = join(directory, "source.txt");
    const outside = join(directory, "..", `jarvix-move-${Date.now()}.txt`);
    const tool = new ApplyPatchTool({
        sandboxPolicy: () => createSandboxPolicy("project-read-write", [directory])
    });
    try {
        writeFileSync(source, "old\n", "utf8");

        const result = await tool.execute(call(directory, [
            "*** Begin Patch",
            "*** Update File: source.txt",
            `*** Move to: ../${outside.split(/[\\/]/).at(-1)}`,
            "@@",
            "-old",
            "+new",
            "*** End Patch"
        ]), { onOutput: () => undefined });

        expect(result.isError).toBe(true);
        expect(result.content).toContain("move destination");
        expect(readFileSync(source, "utf8")).toBe("old\n");
        expect(existsSync(outside)).toBe(false);
    } finally {
        tool.dispose();
        rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});

test("rejects move destinations that collide with another target", async () => {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-apply-patch-collision-"));
    const tool = new ApplyPatchTool();
    try {
        writeFileSync(join(directory, "source.txt"), "source\n", "utf8");
        writeFileSync(join(directory, "destination.txt"), "original\n", "utf8");

        const result = await tool.execute(call(directory, [
            "*** Begin Patch",
            "*** Add File: destination.txt",
            "+replacement",
            "*** Update File: source.txt",
            "*** Move to: destination.txt",
            "@@",
            "-source",
            "+moved",
            "*** End Patch"
        ]), { onOutput: () => undefined });

        expect(result.isError).toBe(true);
        expect(result.content).toContain("multiple operations target");
        expect(readFileSync(join(directory, "source.txt"), "utf8")).toBe("source\n");
        expect(readFileSync(join(directory, "destination.txt"), "utf8")).toBe("original\n");
    } finally {
        tool.dispose();
        rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});

test("rejects a move whose destination is its source", async () => {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-apply-patch-self-move-"));
    const tool = new ApplyPatchTool();
    try {
        writeFileSync(join(directory, "source.txt"), "source\n", "utf8");

        const result = await tool.execute(call(directory, [
            "*** Begin Patch",
            "*** Update File: source.txt",
            "*** Move to: source.txt",
            "@@",
            "-source",
            "+changed",
            "*** End Patch"
        ]), { onOutput: () => undefined });

        expect(result.isError).toBe(true);
        expect(result.content).toContain("multiple operations target");
        expect(readFileSync(join(directory, "source.txt"), "utf8")).toBe("source\n");
    } finally {
        tool.dispose();
        rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});

test("refuses to add over an existing path before writing earlier hunks", async () => {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-apply-patch-add-existing-"));
    const tool = new ApplyPatchTool();
    try {
        writeFileSync(join(directory, "existing.txt"), "keep\n", "utf8");

        const result = await tool.execute(call(directory, [
            "*** Begin Patch",
            "*** Add File: new.txt",
            "+new",
            "*** Add File: existing.txt",
            "+replacement",
            "*** End Patch"
        ]), { onOutput: () => undefined });

        expect(result.isError).toBe(true);
        expect(result.content).toContain("Refusing to overwrite existing path");
        expect(existsSync(join(directory, "new.txt"))).toBe(false);
        expect(readFileSync(join(directory, "existing.txt"), "utf8")).toBe("keep\n");
    } finally {
        tool.dispose();
        rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});

test("refuses to move over an existing path", async () => {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-apply-patch-move-existing-"));
    const tool = new ApplyPatchTool();
    try {
        writeFileSync(join(directory, "source.txt"), "source\n", "utf8");
        writeFileSync(join(directory, "destination.txt"), "keep\n", "utf8");

        const result = await tool.execute(call(directory, [
            "*** Begin Patch",
            "*** Update File: source.txt",
            "*** Move to: destination.txt",
            "@@",
            "-source",
            "+moved",
            "*** End Patch"
        ]), { onOutput: () => undefined });

        expect(result.isError).toBe(true);
        expect(result.content).toContain("Refusing to overwrite existing path");
        expect(readFileSync(join(directory, "source.txt"), "utf8")).toBe("source\n");
        expect(readFileSync(join(directory, "destination.txt"), "utf8")).toBe("keep\n");
    } finally {
        tool.dispose();
        rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
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

function applyPatchSpoolDirectories(): string[] {
    return readdirSync(tmpdir())
        .filter((name) => name.startsWith("jarvix-apply-patch-spool-"))
        .map((name) => join(tmpdir(), name));
}
