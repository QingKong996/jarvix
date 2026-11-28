import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import type { ToolCallEndReason } from "../../../../runtime/tools/types.ts";
import type { ToolCallViewData } from "../../../../runtime/tools/view.ts";
import { AnimatedCollapsibleContent, Collapsible, CollapsibleTrigger } from "@/components/ui/collapsible";
import { quickTransition } from "../../motion.ts";
import { ThinkingBlock } from "./ThinkingBlock.tsx";
import { ToolCallBlock } from "./tools/ToolCallBlock.tsx";

export type ProcessGroupEntry =
    | {
        kind: "thinking";
        key: string;
        text: string;
        streaming?: boolean;
    } | {
        kind: "system";
        key: string;
        text: string;
    } | {
        kind: "tool";
        key: string;
        toolName: string;
        data: ToolCallViewData;
        endReason: ToolCallEndReason | null;
    };

export function ProcessGroup({
    entries,
    defaultOpen
}: {
    entries: readonly ProcessGroupEntry[];
    defaultOpen: boolean;
}) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(defaultOpen);
    const toolCount = entries.filter((entry) => entry.kind === "tool").length;
    const thinkingCount = entries.filter(
        (entry) => entry.kind === "thinking"
    ).length;
    const running = entries.some((entry) => (
        entry.kind === "tool"
        && entry.endReason === null
        && (entry.data.status === "pending" || entry.data.status === "running")
    ));

    useEffect(() => {
        setOpen(defaultOpen);
    }, [defaultOpen]);

    return (
        <Collapsible
            open={open}
            onOpenChange={setOpen}
            data-slot="transcript-process-group"
            className="flex flex-col gap-1.5"
        >
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
                <span className="font-medium">{t("transcript.process.label")}</span>
                {toolCount > 0 ? (
                    <>
                        <span aria-hidden="true" className="opacity-50">·</span>
                        <span>
                            {t("transcript.process.toolCalls", {
                                count: toolCount
                            })}
                        </span>
                    </>
                ) : null}
                {thinkingCount > 0 ? (
                    <>
                        <span aria-hidden="true" className="opacity-50">·</span>
                        <span>
                            {t("transcript.process.thinking", {
                                count: thinkingCount
                            })}
                        </span>
                    </>
                ) : null}
                {running ? (
                    <>
                        <span aria-hidden="true" className="opacity-50">·</span>
                        <span className="animate-pulse text-foreground">
                            {t("tools.status.running")}
                        </span>
                    </>
                ) : null}
            </CollapsibleTrigger>

            <AnimatedCollapsibleContent>
                <div className="ml-1.5 flex flex-col gap-3 border-l border-border pl-3.5">
                    {entries.map((entry) => {
                        if (entry.kind === "thinking") {
                            return (
                                <ThinkingBlock
                                    key={entry.key}
                                    text={entry.text}
                                    streaming={entry.streaming}
                                />
                            );
                        }
                        if (entry.kind === "system") {
                            return (
                                <ThinkingBlock
                                    key={entry.key}
                                    text={entry.text}
                                    label={t("system.message")}
                                />
                            );
                        }
                        return (
                            <ToolCallBlock
                                key={entry.key}
                                toolName={entry.toolName}
                                data={entry.data}
                                endReason={entry.endReason}
                            />
                        );
                    })}
                </div>
            </AnimatedCollapsibleContent>
        </Collapsible>
    );
}
