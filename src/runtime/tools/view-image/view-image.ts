import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { LlmToolCallBlock, LlmToolDefinition } from "../../../protocol/llm.ts";
import type {
    PathAccessDecision,
    PathAccessGuard
} from "../../../core/execution/sandbox.ts";
import type {
    ToolExecutionObserver,
    ToolExecutionResult,
    ToolExecutor,
    ToolStopEvent
} from "../types.ts";
import {
    VIEW_IMAGE_TOOL,
    createViewImageToolCallViewData,
    type ViewImageView
} from "./view.ts";

export { VIEW_IMAGE_TOOL };

const DEFAULT_CWD = process.cwd();
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const viewImageArguments = z.object({
    path: z.string().trim().min(1)
}).strict();

export const VIEW_IMAGE_TOOL_DEFINITIONS: readonly LlmToolDefinition[] = [{
    name: VIEW_IMAGE_TOOL,
    description: [
        "View a local image file from the filesystem when visual inspection is needed.",
        "Use this for images already available on disk.",
        "Relative paths are resolved from the working directory."
    ].join(" "),
    parameters: {
        type: "object",
        properties: {
            path: {
                type: "string",
                description: "Local filesystem path to an image file."
            }
        },
        required: ["path"],
        additionalProperties: false
    }
}];

export type ViewImageToolOptions = {
    defaultCwd?: string | (() => string | undefined);
    sandbox?: PathAccessGuard;
};

/** Loads a local image and returns it as pi-ai image content. */
export class ViewImageTool implements ToolExecutor {
    readonly definitions = VIEW_IMAGE_TOOL_DEFINITIONS;
    private readonly defaultCwd?: string | (() => string | undefined);
    private readonly sandbox?: PathAccessGuard;

    constructor(options: ViewImageToolOptions = {}) {
        this.defaultCwd = options.defaultCwd;
        this.sandbox = options.sandbox;
    }

    handles(name: string): boolean {
        return name === VIEW_IMAGE_TOOL;
    }

    async execute(
        call: LlmToolCallBlock,
        _observer: ToolExecutionObserver,
        signal?: AbortSignal
    ): Promise<ToolExecutionResult> {
        if (signal?.aborted) {
            return failedResult(call, "Image read stopped.", "");
        }

        const parsed = viewImageArguments.safeParse(call.arguments);
        if (!parsed.success) {
            return failedResult(
                call,
                `Invalid arguments for ${call.name}: ${parsed.error.message}`,
                ""
            );
        }

        const path = this.resolvePath(parsed.data.path);
        let decision: PathAccessDecision;
        try {
            decision = this.sandbox
                ? this.sandbox.authorizeRead(path)
                : { allowed: true, path };
        } catch (error) {
            return failedResult(
                call,
                `Failed to check sandbox policy: ${errorMessage(error)}`,
                path
            );
        }
        if (!decision.allowed) {
            return failedResult(
                call,
                `view_image blocked by the sandbox policy: ${decision.reason}`,
                path
            );
        }

        try {
            const metadata = await stat(path);
            if (!metadata.isFile()) {
                return failedResult(call, `Image path is not a file: ${path}`, path);
            }
            if (metadata.size > MAX_IMAGE_BYTES) {
                return failedResult(
                    call,
                    `Image is too large (${metadata.size} bytes; limit ${MAX_IMAGE_BYTES} bytes).`,
                    path
                );
            }

            const bytes = await readFile(path);
            if (signal?.aborted) {
                return failedResult(call, "Image read stopped.", path);
            }
            if (bytes.length > MAX_IMAGE_BYTES) {
                return failedResult(
                    call,
                    `Image is too large (${bytes.length} bytes; limit ${MAX_IMAGE_BYTES} bytes).`,
                    path
                );
            }
            const mimeType = detectImageMimeType(bytes);
            if (!mimeType) {
                return failedResult(
                    call,
                    "Unable to process image: invalid or unsupported image data.",
                    path
                );
            }

            const data = bytes.toString("base64");
            const imageUrl = `data:${mimeType};base64,${data}`;
            const view: ViewImageView = {
                kind: "image.view_image",
                path,
                mimeType,
                imageUrl,
                output: "",
                status: "completed"
            };
            return {
                content: "",
                images: [{
                    type: "image",
                    data,
                    mimeType
                }],
                data: view,
                isError: false,
                endReason: "exited"
            };
        } catch (error) {
            return failedResult(
                call,
                `Unable to read image at ${path}: ${errorMessage(error)}`,
                path
            );
        }
    }

    dispose(): void {
        // No resources to release.
    }

    async stop(): Promise<readonly ToolStopEvent[]> {
        return [];
    }

    private resolvePath(path: string): string {
        const configured = typeof this.defaultCwd === "function"
            ? this.defaultCwd()
            : this.defaultCwd;
        return resolve(configured ?? DEFAULT_CWD, path);
    }
}

function detectImageMimeType(bytes: Buffer): string | null {
    if (
        bytes.length >= 8 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0d &&
        bytes[5] === 0x0a &&
        bytes[6] === 0x1a &&
        bytes[7] === 0x0a
    ) {
        return "image/png";
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return "image/jpeg";
    }
    const signature = bytes.subarray(0, 6).toString("ascii");
    if (signature === "GIF87a" || signature === "GIF89a") {
        return "image/gif";
    }
    if (
        bytes.length >= 12 &&
        bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
        bytes.subarray(8, 12).toString("ascii") === "WEBP"
    ) {
        return "image/webp";
    }
    return null;
}

function failedResult(
    call: LlmToolCallBlock,
    message: string,
    path: string
): ToolExecutionResult {
    const view = createViewImageToolCallViewData(call.name, call.arguments, "failed")
        ?? {
            kind: "image.view_image" as const,
            path,
            mimeType: "",
            imageUrl: "",
            output: "",
            status: "failed" as const
        };
    return {
        content: message,
        data: {
            ...view,
            path: path || view.path,
            output: message,
            status: "failed"
        },
        isError: true,
        endReason: "exited"
    };
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
