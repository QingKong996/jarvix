/**
 * OpenAI apply_patch compatibility.
 * Uses the OpenAI Codex apply_patch format and semantics through the local tool transport.
 * Source: https://github.com/openai/codex/tree/main/codex-rs/apply-patch
 */
import { z } from "zod";
import type { LlmToolCallBlock, LlmToolDefinition } from "../../../protocol/llm.ts";
import {
    applyParsedPatch,
    formatPatchChanges,
    formatPatchSummary,
    patchWriteTargets,
    type AffectedPaths
} from "./apply-patch-engine.ts";
import {
    ApplyPatchParseError,
    parseApplyPatch
} from "./apply-patch-parser.ts";
import type {
    PathAccessDecision,
    PathAccessGuard
} from "../../../core/execution/sandbox.ts";
import { formatSandboxViolations } from "../../../core/permissions/violations.ts";
import type {
    ToolExecutionResult,
    ToolExecutionObserver,
    ToolExecutor,
    ToolStopEvent
} from "../types.ts";
import {
    createGenericToolCallViewData
} from "../tool-view.ts";
import {
    APPLY_PATCH_TOOL,
    createApplyPatchToolCallViewData,
    type ApplyPatchView
} from "./view.ts";
import { resolve } from "node:path";

export { APPLY_PATCH_TOOL };

const DEFAULT_CWD = process.cwd();

const applyPatchArguments = z.object({
    patch: z.string(),
    cwd: z.string().trim().min(1)
});

export const APPLY_PATCH_TOOL_DEFINITIONS: readonly LlmToolDefinition[] = [{
    name: APPLY_PATCH_TOOL,
    description: [
        "Edit text files using OpenAI's apply_patch format.",
        "Pass the complete patch in patch, including the *** Begin Patch and *** End Patch markers.",
        "Paths are resolved relative to cwd unless they are absolute.",
        "Every Add File content line starts with '+'; update context starts with ' ', removals with '-', and additions with '+'.",
        "Update hunks support optional '@@ context', '*** Move to: path', and '*** End of File' lines.",
        "Example:",
        "*** Begin Patch",
        "*** Update File: src/example.ts",
        "@@",
        "-old",
        "+new",
        "*** End Patch"
    ].join("\n"),
    parameters: {
        type: "object",
        properties: {
            patch: {
                type: "string",
                description: "Complete OpenAI apply_patch text."
            },
            cwd: {
                type: "string",
                description: "Absolute working directory used to resolve relative paths."
            }
        },
        required: ["patch", "cwd"],
        additionalProperties: false
    }
}];

export type ApplyPatchToolOptions = {
    defaultCwd?: string | (() => string | undefined);
    sandbox?: PathAccessGuard;
};

/** Executes OpenAI apply_patch hunks against the local filesystem. */
export class ApplyPatchTool implements ToolExecutor {
    readonly definitions = APPLY_PATCH_TOOL_DEFINITIONS;
    private readonly defaultCwd?: string | (() => string | undefined);
    private readonly sandbox?: PathAccessGuard;

    constructor(options: ApplyPatchToolOptions = {}) {
        this.defaultCwd = options.defaultCwd;
        this.sandbox = options.sandbox;
    }

    handles(name: string): boolean {
        return name === APPLY_PATCH_TOOL;
    }

    async execute(
        call: LlmToolCallBlock,
        _observer: ToolExecutionObserver,
        signal?: AbortSignal
    ): Promise<ToolExecutionResult> {
        if (signal?.aborted) {
            return failedResult(call, "Apply patch aborted.");
        }

        const arguments_ = applyPatchArguments.safeParse(call.arguments);
        if (!arguments_.success) {
            return failedResult(call, `Invalid arguments for ${call.name}: ${arguments_.error.message}`);
        }

        let parsed;
        try {
            parsed = parseApplyPatch(arguments_.data.patch);
        } catch (error) {
            return failedResult(call, formatParseError(error));
        }

        const cwd = this.resolveCwd(arguments_.data.cwd);
        const targets = patchWriteTargets(parsed, cwd);
        let decisions: readonly PathAccessDecision[];
        try {
            decisions = this.sandbox
                ? this.sandbox.authorizeWrites(
                    targets.map((target) => target.path)
                )
                : targets.map((target): PathAccessDecision => ({
                    allowed: true,
                    path: target.path
                }));
        } catch (error) {
            return failedResult(call, `Failed to check sandbox policy: ${errorMessage(error)}`);
        }
        const denied = decisions.flatMap((decision, index) => {
            const target = targets[index];
            return target && !decision.allowed
                ? [{ decision, target }]
                : [];
        });
        if (denied.length > 0) {
            return sandboxDeniedResult(call, arguments_.data, denied);
        }

        try {
            const affected = await applyParsedPatch(parsed, cwd, signal);
            if (affected.error) {
                return partialFailureResult(
                    { ...arguments_.data, cwd },
                    affected,
                    `Failed to apply patch: ${affected.error}`
                );
            }
            if (affected.aborted) {
                return abortedResult({ ...arguments_.data, cwd }, affected);
            }
            const summary = formatPatchSummary(affected);
            const data: ApplyPatchView = {
                kind: "apply_patch",
                patch: arguments_.data.patch,
                cwd,
                output: summary,
                status: "completed"
            };
            return {
                content: summary,
                data,
                isError: false,
                endReason: "exited"
            };
        } catch (error) {
            return failedResult(call, `Failed to apply patch: ${errorMessage(error)}`);
        }
    }

    dispose(): void {
        // No resources to release.
    }

    async stop(): Promise<readonly ToolStopEvent[]> {
        return [];
    }

    private resolveCwd(cwd: string): string {
        const configured = typeof this.defaultCwd === "function"
            ? this.defaultCwd()
            : this.defaultCwd;
        return resolve(configured ?? DEFAULT_CWD, cwd);
    }
}

function failedResult(call: LlmToolCallBlock, message: string): ToolExecutionResult {
    const data = createApplyPatchToolCallViewData(call.name, call.arguments, "failed")
        ?? createGenericToolCallViewData(call.name, call.arguments, "failed");
    return {
        content: message,
        data: { ...data, output: message },
        isError: true,
        endReason: "exited"
    };
}

function sandboxDeniedResult(
    call: LlmToolCallBlock,
    arguments_: z.infer<typeof applyPatchArguments>,
    denied: ReadonlyArray<{
        decision: Extract<PathAccessDecision, { allowed: false }>;
        target: {
            path: string;
            operation: string;
        };
    }>
): ToolExecutionResult {
    const invocationId = call.id;
    const lines = denied.map(({ decision, target }) =>
        `apply_patch ${invocationId} blocked ${target.operation} ${decision.path}: ${decision.reason}`
    );
    const output = [
        `Apply patch blocked by the sandbox policy (invocation ${invocationId}).`,
        formatSandboxViolations(lines)
    ].join("\n");
    const data: ApplyPatchView = {
        kind: "apply_patch",
        patch: arguments_.patch,
        cwd: arguments_.cwd,
        output,
        status: "failed"
    };
    return {
        content: output,
        data,
        isError: true,
        endReason: "exited"
    };
}

function abortedResult(
    arguments_: z.infer<typeof applyPatchArguments>,
    affected: AffectedPaths
): ToolExecutionResult {
    const applied = affected.added.length + affected.modified.length + affected.deleted.length;
    const output = applied === 0
        ? "Apply patch stopped. No changes were applied."
        : [
            "Apply patch stopped.",
            "Changes applied before stopping:",
            formatPatchChanges(affected)
        ].join("\n");
    const data: ApplyPatchView = {
        kind: "apply_patch",
        patch: arguments_.patch,
        cwd: arguments_.cwd,
        output,
        status: "failed"
    };
    return {
        content: output,
        data,
        isError: true,
        endReason: "exited"
    };
}

function partialFailureResult(
    arguments_: z.infer<typeof applyPatchArguments>,
    affected: AffectedPaths,
    message: string
): ToolExecutionResult {
    const applied = affected.added.length + affected.modified.length + affected.deleted.length;
    const output = applied === 0
        ? `${message}\n\nNo file operations completed before the failure.`
        : [
            message,
            "Changes applied before the failure:",
            formatPatchChanges(affected)
        ].join("\n");
    const data: ApplyPatchView = {
        kind: "apply_patch",
        patch: arguments_.patch,
        cwd: arguments_.cwd,
        output,
        status: "failed"
    };
    return {
        content: output,
        data,
        isError: true,
        endReason: "exited"
    };
}

function formatParseError(error: unknown): string {
    if (error instanceof ApplyPatchParseError) {
        return error.lineNumber === undefined
            ? `Invalid patch: ${error.message}`
            : `Invalid patch hunk on line ${error.lineNumber}: ${error.message}`;
    }
    return `Invalid patch: ${errorMessage(error)}`;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
