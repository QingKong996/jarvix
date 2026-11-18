import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "cn";
import type { ContextMessageEntry } from "./context-messages.ts";

type RoleLabelKey =
    | "rightSidebar.context.roles.system"
    | "rightSidebar.context.roles.user"
    | "rightSidebar.context.roles.assistant"
    | "rightSidebar.context.roles.toolResult";

const TYPE_STYLE: Record<ContextMessageEntry["role"], {
    labelKey: RoleLabelKey;
    badge: string;
}> = {
    system: {
        labelKey: "rightSidebar.context.roles.system",
        badge: "border-amber-400/25 bg-amber-400/10 text-amber-700 dark:text-amber-200"
    },
    user: {
        labelKey: "rightSidebar.context.roles.user",
        badge: "border-sky-400/25 bg-sky-400/10 text-sky-700 dark:text-sky-200"
    },
    assistant: {
        labelKey: "rightSidebar.context.roles.assistant",
        badge: "border-fuchsia-400/25 bg-fuchsia-400/10 text-fuchsia-700 dark:text-fuchsia-200"
    },
    toolResult: {
        labelKey: "rightSidebar.context.roles.toolResult",
        badge: "border-emerald-400/25 bg-emerald-400/10 text-emerald-700 dark:text-emerald-200"
    }
};

export function ContextMessage({ entry }: { entry: ContextMessageEntry }) {
    const { t } = useTranslation();
    const style = TYPE_STYLE[entry.role];

    return (
        <article className="border-b border-border/60 last:border-b-0">
            <details className="group">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 outline-none focus-visible:bg-muted/30 [&::-webkit-details-marker]:hidden">
                    <span className={cn(
                        "inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                        style.badge
                    )}>
                        {t(style.labelKey)}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                        {entry.preview || t("rightSidebar.context.emptyMessage")}
                    </span>
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground group-open:rotate-90" />
                </summary>
                <pre className="border-t border-border/40 px-3 py-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-foreground/85">
                    {entry.text || t("rightSidebar.context.emptyMessage")}
                </pre>
            </details>
        </article>
    );
}
