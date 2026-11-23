import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { cn } from "cn";
import type { ToolCallEndReason } from "../../../../../runtime/tools/types.ts";
import type { ToolCallViewData } from "../../../../../runtime/tools/view.ts";
import { ApplyPatchDiff } from "./ApplyPatchDiff.tsx";
import { ShellToolCall } from "./ShellToolCall.tsx";
import { LocalTimeToolCall, SleepToolCall } from "./TimeToolCall.tsx";
import { PermissionRequestToolCall } from "./PermissionRequestToolCall.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";

type ToolCallBlockProps = {
    toolName: string;
    data: ToolCallViewData;
    isError: boolean;
    endReason: ToolCallEndReason | null;
};

export function ToolCallBlock({ toolName, data, isError, endReason }: ToolCallBlockProps) {
    const { t } = useTranslation();
    if (data.kind === "permission.request") {
        return <PermissionRequestToolCall data={data} isError={isError} />;
    }
    const active = endReason === null
        && (data.status === "pending" || data.status === "running");
    const streaming = active;
    const [open, setOpen] = useState(active);

    return (
        <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-1.5">
            <CollapsibleTrigger
                type="button"
                className="group -ml-5 flex w-fit items-center gap-1.5 rounded-md text-[13px] text-muted-foreground transition-colors outline-none select-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
                <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
                <span className={cn(active && "animate-pulse")}>{toolLabel(toolName, data, t)}</span>
                <span aria-hidden="true">·</span>
                <span>{statusLabel(data.status, isError, endReason, t)}</span>
            </CollapsibleTrigger>

            <CollapsibleContent>
                <div className="flex flex-col gap-2 border-l-2 pl-3">
                    {data.kind === "apply_patch" ? (
                        <ApplyPatchDiff patch={data.patch} />
                    ) : data.kind === "time.local_time" ? (
                        <LocalTimeToolCall data={data} />
                    ) : data.kind === "time.sleep" ? (
                        <SleepToolCall data={data} />
                    ) : data.kind === "generic" ? (
                        open ? (
                            <pre className="font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
                                {JSON.stringify(data.arguments, null, 2)}
                            </pre>
                        ) : null
                    ) : (
                        <ShellToolCall
                            data={data}
                            streaming={streaming}
                            isError={isError}
                        />
                    )}
                    {data.kind === "generic" && data.output.length > 0 ? (
                        <ToolOutput text={data.output} streaming={streaming} />
                    ) : null}
                </div>
            </CollapsibleContent>
        </Collapsible>
    );
}

function ToolOutput({ text, streaming }: { text: string; streaming: boolean }) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (streaming && ref.current) {
            ref.current.scrollTop = ref.current.scrollHeight;
        }
    }, [streaming, text]);

    return (
        <ScrollArea
            viewportRef={ref}
            className="max-h-80"
            viewportClassName="h-auto max-h-[inherit]"
        >
            <pre className="font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-words text-muted-foreground">
                {text}
            </pre>
        </ScrollArea>
    );
}

function toolLabel(toolName: string, data: ToolCallViewData, t: TFunction<"translation">): string {
    if (data.kind === "shell.exec_command") {
        return t("tools.execCommand");
    }
    if (data.kind === "shell.write_stdin") {
        return t("tools.writeStdin");
    }
    if (data.kind === "apply_patch") {
        return t("tools.applyPatch");
    }
    if (data.kind === "time.local_time") {
        return t("tools.localTime");
    }
    if (data.kind === "time.sleep") {
        return t("tools.sleep");
    }
    return `${t("tools.generic")} · ${toolName}`;
}

function statusLabel(
    status: ToolCallViewData["status"],
    isError: boolean,
    endReason: ToolCallEndReason | null,
    t: TFunction<"translation">
): string {
    if (isError || status === "failed") {
        return t("tools.status.failed");
    }
    if (endReason === "terminated") {
        return t("tools.status.terminated");
    }
    if (endReason === "background") {
        return t("tools.status.background");
    }
    switch (status) {
        case "pending":
        case "running":
            return t("tools.status.running");
        case "timed_out":
            return t("tools.status.background");
        case "completed":
            return t("tools.status.completed");
    }
}
