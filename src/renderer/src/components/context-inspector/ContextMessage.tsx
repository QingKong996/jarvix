import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "cn";
import type { ContextMessageEntry } from "./context-messages.ts";

type KindLabelKey =
    | "rightSidebar.context.roles.system"
    | "rightSidebar.context.roles.injected"
    | "rightSidebar.context.roles.user"
    | "rightSidebar.context.roles.assistant"
    | "rightSidebar.context.roles.toolCall"
    | "rightSidebar.context.roles.toolResult";

const TYPE_STYLE: Record<ContextMessageEntry["kind"], {
    labelKey: KindLabelKey;
    badge: string;
}> = {
    system: {
        labelKey: "rightSidebar.context.roles.system",
        badge: "border-border bg-secondary text-muted-foreground"
    },
    injected: {
        labelKey: "rightSidebar.context.roles.injected",
        badge: "border-border bg-secondary text-[var(--context-injected)]"
    },
    user: {
        labelKey: "rightSidebar.context.roles.user",
        badge: "border-border-strong bg-foreground/8 text-foreground"
    },
    assistant: {
        labelKey: "rightSidebar.context.roles.assistant",
        badge: "border-border bg-muted text-foreground/85"
    },
    toolCall: {
        labelKey: "rightSidebar.context.roles.toolCall",
        badge: "border-border bg-surface-subtle text-muted-foreground"
    },
    toolResult: {
        labelKey: "rightSidebar.context.roles.toolResult",
        badge: "border-border bg-surface-subtle text-muted-foreground"
    }
};

export function ContextMessage({ entry }: { entry: ContextMessageEntry }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const style = TYPE_STYLE[entry.kind];
    const text = useMemo(() => open ? entry.text() : "", [entry, open]);

    return (
        <article className="border-b border-border/70 last:border-b-0 [contain-intrinsic-size:auto_3rem] [content-visibility:auto]">
            <details
                className="group"
                onToggle={(event) => setOpen(event.currentTarget.open)}
            >
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/60 [&::-webkit-details-marker]:hidden">
                    <span className={cn(
                        "inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[10px] leading-tight font-medium",
                        style.badge
                    )}>
                        {t(style.labelKey)}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                        {entry.preview || t("rightSidebar.context.emptyMessage")}
                    </span>
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
                </summary>
                {open ? (
                    <pre className="border-t border-border bg-surface-subtle px-3 py-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-foreground/90">
                        {text || t("rightSidebar.context.emptyMessage")}
                    </pre>
                ) : null}
            </details>
        </article>
    );
}
