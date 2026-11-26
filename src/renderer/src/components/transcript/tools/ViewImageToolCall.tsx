import type { ViewImageView } from "../../../../../runtime/tools/view.ts";

type ViewImageToolCallProps = {
    data: ViewImageView;
};

export function ViewImageToolCall({ data }: ViewImageToolCallProps) {
    return (
        <div data-slot="view-image-tool" className="flex min-w-0 flex-col gap-2">
            <span className="truncate font-mono text-[12px] text-muted-foreground">
                {data.path}
            </span>
            {data.imageUrl.length > 0 ? (
                <img
                    src={data.imageUrl}
                    alt={data.path}
                    loading="lazy"
                    decoding="async"
                    className="max-h-96 max-w-full rounded-xl border border-border/80 bg-surface-subtle object-contain"
                />
            ) : null}
            {data.output.length > 0 ? (
                <pre
                    role={data.status === "failed" ? "alert" : undefined}
                    className="font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-words text-destructive"
                >
                    {data.output}
                </pre>
            ) : null}
        </div>
    );
}
