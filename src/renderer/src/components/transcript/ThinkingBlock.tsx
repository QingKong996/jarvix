import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "cn";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

type ThinkingBlockProps = {
    text: string;
    streaming?: boolean;
    label?: string | null;
};

export function ThinkingBlock({ text, streaming = false, label }: ThinkingBlockProps) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(streaming);
    const defaultLabel = streaming ? t("thinking.streaming") : t("thinking.label");
    const displayLabel = label === undefined ? defaultLabel : label;

    return (
        <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-1.5">
            <CollapsibleTrigger
                type="button"
                aria-label={displayLabel ?? t("system.message")}
                className="group -ml-5 flex w-fit items-center gap-1.5 rounded-md text-[13px] text-muted-foreground transition-colors outline-none select-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
                <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
                {displayLabel ? (
                    <span className={cn(streaming && "animate-pulse")}>{displayLabel}</span>
                ) : null}
            </CollapsibleTrigger>

            <CollapsibleContent>
                <p className="border-l-2 pl-3 text-[13px] leading-relaxed whitespace-pre-wrap text-muted-foreground italic">
                    {text}
                </p>
            </CollapsibleContent>
        </Collapsible>
    );
}
