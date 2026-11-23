import {
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
    type PathLike,
    type RmOptions
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import type { LlmToolCallBlock } from "../../../protocol/llm.ts";
import { APPLY_PATCH_TOOL, ApplyPatchTool } from "./apply-patch.ts";

const removeFailure = vi.hoisted(() => ({
    enabled: false,
    path: ""
}));

vi.mock("node:fs", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs")>();
    return {
        ...actual,
        rmSync(path: PathLike, options?: RmOptions): void {
            if (
                removeFailure.enabled &&
                typeof path === "string" &&
                path === removeFailure.path
            ) {
                throw new Error("simulated remove failure");
            }
            actual.rmSync(path, options);
        }
    };
});

test("reports files changed before a runtime write failure", async () => {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-apply-patch-runtime-"));
    const tool = new ApplyPatchTool();
    const source = join(directory, "source.txt");
    try {
        writeFileSync(join(directory, "update.txt"), "old\n", "utf8");
        writeFileSync(source, "source\n", "utf8");
        removeFailure.path = source;
        removeFailure.enabled = true;

        const result = await tool.execute(call(directory, [
            "*** Begin Patch",
            "*** Add File: first.txt",
            "+first",
            "*** Update File: update.txt",
            "@@",
            "-old",
            "+new",
            "*** Update File: source.txt",
            "*** Move to: moved.txt",
            "@@",
            "-source",
            "+moved",
            "*** End Patch"
        ]), { onOutput: () => undefined });

        expect(result.isError).toBe(true);
        expect(result.content).toContain("Failed to apply patch");
        expect(result.content).toContain("simulated remove failure");
        expect(result.content).toContain("Changes applied before the failure:");
        expect(result.content).toContain("A first.txt");
        expect(result.content).toContain("M update.txt");
        expect(result.content).toContain("A moved.txt");
        expect(result.content).not.toContain("Success.");
        expect(result.data).toMatchObject({
            kind: "apply_patch",
            status: "failed",
            output: result.content
        });
        expect(readFileSync(join(directory, "first.txt"), "utf8")).toBe("first\n");
        expect(readFileSync(join(directory, "update.txt"), "utf8")).toBe("new\n");
        expect(readFileSync(join(directory, "moved.txt"), "utf8")).toBe("moved\n");
        expect(readFileSync(source, "utf8")).toBe("source\n");
    } finally {
        removeFailure.enabled = false;
        tool.dispose();
        rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});

function call(cwd: string, patchLines: string[]): LlmToolCallBlock {
    return {
        type: "toolCall",
        id: "call-apply-patch-runtime",
        name: APPLY_PATCH_TOOL,
        arguments: {
            patch: patchLines.join("\n"),
            cwd
        }
    };
}
