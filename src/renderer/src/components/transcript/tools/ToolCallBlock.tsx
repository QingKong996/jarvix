import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { motion } from "motion/react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { cn } from "cn";
import type { ToolCallEndReason } from "../../../../../runtime/tools/types.ts";
import type { ToolCallViewData } from "../../../../../runtime/tools/view.ts";
import {
    FINISH_GOAL_TOOL,
    UPDATE_GOAL_TOOL
} from "../../../../../runtime/tools/goal/goal-tools.ts";
import { ApplyPatchDiff } from "./ApplyPatchDiff.tsx";
import { ShellToolCall } from "./ShellToolCall.tsx";
import { LocalTimeToolCall, SleepToolCall } from "./TimeToolCall.tsx";
import { PermissionRequestToolCall } from "./PermissionRequestToolCall.tsx";
import { ViewImageToolCall } from "./ViewImageToolCall.tsx";
import { AnimatedCollapsibleContent, Collapsible, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { quickTransition } from "../../../motion.ts";

type ToolCallBlockProps = {
    toolName: string;
    data: ToolCallViewData;
    isError: boolean;
    endReason: ToolCallEndReason | null;
};

export function ToolCallBlock({ toolName, data, isError, endReason }: ToolCallBlockProps) {
    const { t } = useTranslation();
    const active = endReason === null
        && (data.status === "pending" || data.status === "running");
    const streaming = active;
    // Image results stay expanded; only the surrounding process group collapses them.
    const staysExpanded = data.kind === "image.view_image";
    const [open, setOpen] = useState(active || staysExpanded);

    useEffect(() => {
        if (!active && !staysExpanded) {
            setOpen(false);
        }
    }, [active, staysExpanded]);

    if (data.kind === "permission.request") {
        return <PermissionRequestToolCall data={data} isError={isError} />;
    }

    const failed = isError || data.status === "failed";

    return (
        <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-1.5">
            <CollapsibleTrigger
                type="button"
                className="group -ml-2 flex w-fit items-center gap-1.5 rounded-lg px-2 py-0 text-[13px] text-muted-foreground transition-colors outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/25"
            >
                <motion.span
                    aria-hidden="true"
                    animate={{ rotate: open ? 90 : 0 }}
                    transition={quickTransition}
                    className="inline-flex shrink-0"
                >
                    <ChevronRight className="size-3.5" />
                </motion.span>
                <span className={cn("font-medium", active && "animate-pulse")}>
                    {toolLabel(toolName, data, t)}
                </span>
                <span aria-hidden="true" className="opacity-50">·</span>
                <span
                    className={cn(
                        failed
                            ? "text-destructive"
                            : active
                                ? "text-foreground"
                                : "text-muted-foreground"
                    )}
                >
                    {statusLabel(data.status, isError, endReason, t)}
                </span>
            </CollapsibleTrigger>

            <AnimatedCollapsibleContent>
                <div className="ml-1.5 flex flex-col gap-2 border-l border-border pl-3.5">
                    {data.kind === "apply_patch" ? (
                        <ApplyPatchDiff patch={data.patch} />
                    ) : data.kind === "time.local_time" ? (
                        <LocalTimeToolCall data={data} />
                    ) : data.kind === "time.sleep" ? (
                        <SleepToolCall data={data} />
                    ) : data.kind === "image.view_image" ? (
                        <ViewImageToolCall data={data} />
                    ) : data.kind === "generic" ? (
                        open ? (
                            <pre className="overflow-x-auto rounded-xl border border-border/80 bg-surface-subtle p-3.5 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
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
            </AnimatedCollapsibleContent>
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
            className="max-h-80 overflow-hidden rounded-xl border border-border/80 bg-surface-subtle"
            viewportClassName="h-auto max-h-[inherit]"
        >
            <pre className="px-3 py-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-muted-foreground">
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
    if (data.kind === "image.view_image") {
        return t("tools.viewImage");
    }
    if (toolName === UPDATE_GOAL_TOOL) {
        return t("tools.updateGoal");
    }
    if (toolName === FINISH_GOAL_TOOL) {
        return t("tools.finishGoal");
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
