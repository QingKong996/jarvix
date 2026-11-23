import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "cn";
import type {
    ShellExecCommandView,
    ShellWriteStdinView
} from "../../../../../runtime/tools/view.ts";

type ShellToolCallProps = {
    data: ShellExecCommandView | ShellWriteStdinView;
    streaming: boolean;
    isError: boolean;
};

export function ShellToolCall({ data, streaming, isError }: ShellToolCallProps) {
    const { t } = useTranslation();
    const viewportRef = useRef<HTMLDivElement>(null);
    const writing = data.kind === "shell.write_stdin";

    useEffect(() => {
        if (streaming && viewportRef.current) {
            viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
        }
    }, [data.output, streaming]);

    return (
        <div
            data-slot="shell-tool"
            data-kind={data.kind}
            className="overflow-hidden rounded-lg border border-[#30363d] bg-[#0d1117] shadow-sm"
        >
            <div
                ref={viewportRef}
                className="max-h-96 overflow-auto font-mono text-[12px] leading-5"
            >
                <div className="w-max min-w-full px-3 py-3">
                    {data.command.length > 0 ? (
                        <div className="flex gap-2 whitespace-pre">
                            <span className="shrink-0 text-[#58a6ff] select-none">
                                {writing ? "›" : "$"}
                            </span>
                            <span className="text-[#e6edf3]">{data.command}</span>
                        </div>
                    ) : (
                        <div className="flex gap-2 text-[#8b949e]">
                            <span className="select-none">›</span>
                            <span>{t("tools.shellDetails.polling")}</span>
                        </div>
                    )}

                    {data.output.length > 0 ? (
                        <pre
                            className={cn(
                                "mt-1 whitespace-pre text-[#c9d1d9]",
                                isError && "text-[#ffa198]"
                            )}
                        >
                            {data.output}
                        </pre>
                    ) : null}
                    {streaming ? (
                        <span
                            aria-hidden="true"
                            className="mt-1 inline-block h-4 w-1.5 animate-pulse bg-[#58a6ff] align-top"
                        />
                    ) : null}
                </div>
            </div>
        </div>
    );
}
