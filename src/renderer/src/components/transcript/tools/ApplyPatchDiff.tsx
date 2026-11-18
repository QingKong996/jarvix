import { memo } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "cn";

type ApplyPatchDiffProps = {
    patch: string;
};

export const PATCH_PREVIEW_LINE_LIMIT = 400;
const PATCH_PREVIEW_CHAR_LIMIT = 64 * 1024;

type PatchPreview = {
    lines: string[];
    omittedLines: number;
    truncated: boolean;
};

export function patchPreview(patch: string): PatchPreview {
    const lines: string[] = [];
    let characters = 0;
    let lineStart = 0;

    while (true) {
        if (lines.length >= PATCH_PREVIEW_LINE_LIMIT) {
            return {
                lines,
                omittedLines: countLineSegments(patch, lineStart),
                truncated: true
            };
        }

        const newline = patch.indexOf("\n", lineStart);
        const lineEnd = newline === -1 ? patch.length : newline;
        let contentEnd = lineEnd;
        if (contentEnd > lineStart && patch.charCodeAt(contentEnd - 1) === 0x0d) {
            contentEnd -= 1;
        }
        const lineLength = contentEnd - lineStart;
        const remaining = PATCH_PREVIEW_CHAR_LIMIT - characters;
        if (remaining <= 0) {
            return {
                lines,
                omittedLines: countLineSegments(patch, lineStart),
                truncated: true
            };
        }
        if (lineLength > remaining) {
            const prefixLength = remaining - 1;
            const prefix = patch.slice(lineStart, lineStart + prefixLength);
            lines.push(`${cutAtCharacterBoundary(prefix, prefixLength)}…`);
            return {
                lines,
                omittedLines: newline === -1
                    ? 0
                    : countLineSegments(patch, newline + 1),
                truncated: true
            };
        }

        lines.push(patch.slice(lineStart, contentEnd));
        characters += lineLength + 1;
        if (newline === -1) {
            break;
        }
        lineStart = newline + 1;
    }

    return { lines, omittedLines: 0, truncated: false };
}

function countLineSegments(text: string, start: number): number {
    let count = 1;
    let newline = text.indexOf("\n", start);
    while (newline !== -1) {
        count += 1;
        newline = text.indexOf("\n", newline + 1);
    }
    return count;
}

export const ApplyPatchDiff = memo(function ApplyPatchDiff({ patch }: ApplyPatchDiffProps) {
    const { t } = useTranslation();
    if (patch.length === 0) {
        return null;
    }
    const preview = patchPreview(patch);

    return (
        <div
            data-slot="apply-patch-diff"
            className="overflow-hidden rounded-md border bg-muted/10 font-mono text-[12px] leading-5 text-foreground"
        >
            <div className="max-h-96 overflow-auto">
                <div className="min-w-max">
                    {preview.lines.map((line, index) => (
                        <PatchLine key={index} line={line} />
                    ))}
                    {preview.truncated ? (
                        <div
                            data-slot="apply-patch-preview-notice"
                            className="border-t px-3 py-2 text-[11px] text-muted-foreground"
                        >
                            {t("tools.patchDetails.truncated")}
                            {preview.omittedLines > 0
                                ? ` ${t("tools.patchDetails.omittedLines", {
                                    count: preview.omittedLines
                                })}`
                                : null}
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
});

function PatchLine({ line }: { line: string }) {
    const kind = line.startsWith("+") ? "add" : line.startsWith("-") ? "remove" : "plain";

    return (
        <div
            data-kind={kind}
            className={cn(
                "min-h-5 px-3 whitespace-pre",
                kind === "add" && "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
                kind === "remove" && "bg-red-500/15 text-red-800 dark:text-red-200",
                kind === "plain" && "text-muted-foreground"
            )}
        >
            {line}
        </div>
    );
}

function cutAtCharacterBoundary(text: string, length: number): string {
    const cut = text.slice(0, Math.max(0, length));
    return /[\uD800-\uDBFF]$/u.test(cut) ? cut.slice(0, -1) : cut;
}
