import { memo } from "react";
import { cn } from "cn";

type ApplyPatchDiffProps = {
    patch: string;
};

export const ApplyPatchDiff = memo(function ApplyPatchDiff({ patch }: ApplyPatchDiffProps) {
    if (patch.length === 0) {
        return null;
    }

    return (
        <div
            data-slot="apply-patch-diff"
            className="overflow-hidden rounded-md border bg-muted/10 font-mono text-[12px] leading-5 text-foreground"
        >
            <div className="max-h-96 overflow-auto">
                <div className="min-w-max">
                    {patch.split(/\r?\n/).map((line, index) => (
                        <PatchLine key={index} line={line} />
                    ))}
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
