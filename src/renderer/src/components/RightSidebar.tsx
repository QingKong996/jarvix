import { useEffect, useRef, useState } from "react";
import {
    ChevronRight,
    PanelRightClose,
    PanelRightOpen,
    Terminal
} from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { cn } from "cn";
import type { ToolTaskSnapshot } from "../../../tools/types.ts";
import { useBackgroundTasks } from "../background-task-store.ts";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";

type RightSidebarProps = {
    open: boolean;
    sessionId: string | null;
    onToggle(): void;
};

const TABS = [{
    id: "background",
    icon: Terminal,
    labelKey: "rightSidebar.tabs.background"
}] as const;

type TabId = typeof TABS[number]["id"];

export function RightSidebar({ open, sessionId, onToggle }: RightSidebarProps) {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState<TabId>("background");

    if (!open) {
        return (
            <aside className="flex h-full w-10 shrink-0 flex-col items-center border-l border-border bg-secondary/20 py-3">
                <button
                    type="button"
                    aria-label={t("rightSidebar.open")}
                    onClick={onToggle}
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                    <PanelRightOpen className="size-4" />
                </button>
            </aside>
        );
    }

    return (
        <aside className="flex h-full w-80 shrink-0 flex-col border-l border-border bg-secondary/20">
            <header className="flex items-center border-b border-border pr-2">
                <div role="tablist" className="flex min-w-0 flex-1">
                    {TABS.map((tab) => {
                        const Icon = tab.icon;
                        const active = tab.id === activeTab;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                role="tab"
                                aria-selected={active}
                                onClick={() => setActiveTab(tab.id)}
                                className={cn(
                                    "flex items-center gap-1.5 border-b-2 px-4 py-3 text-xs font-medium transition-colors",
                                    active
                                        ? "border-primary text-foreground"
                                        : "border-transparent text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <Icon className="size-3.5" />
                                {t(tab.labelKey)}
                            </button>
                        );
                    })}
                </div>
                <button
                    type="button"
                    aria-label={t("rightSidebar.close")}
                    onClick={onToggle}
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                    <PanelRightClose className="size-4" />
                </button>
            </header>

            <div role="tabpanel" className="flex min-h-0 flex-1 flex-col">
                {activeTab === "background" ? <BackgroundTaskList sessionId={sessionId} /> : null}
            </div>
        </aside>
    );
}

function BackgroundTaskList({ sessionId }: { sessionId: string | null }) {
    const { t } = useTranslation();
    const tasks = useBackgroundTasks(sessionId);

    if (tasks.length === 0) {
        return (
            <p className="px-4 py-3 text-xs text-muted-foreground">
                {t("rightSidebar.empty")}
            </p>
        );
    }

    return (
        <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-2 p-3">
                {tasks.map((task) => (
                    <BackgroundTaskItem key={task.id} task={task} />
                ))}
            </div>
        </ScrollArea>
    );
}

function BackgroundTaskItem({ task }: { task: ToolTaskSnapshot }) {
    const { t } = useTranslation();
    const streaming = task.status === "running";
    const [open, setOpen] = useState(streaming);

    return (
        <Collapsible open={open} onOpenChange={setOpen} className="rounded-md border border-border bg-background/60">
            <CollapsibleTrigger
                type="button"
                title={task.command}
                className="group flex w-full items-center gap-2 px-2.5 py-2 text-left"
            >
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
                <code className="min-w-0 flex-1 truncate font-mono text-[12px]">
                    {task.command}
                </code>
                <span className={cn(
                    "shrink-0 text-[11px] text-muted-foreground",
                    streaming && "animate-pulse"
                )}>
                    {taskStatus(task, t)}
                </span>
            </CollapsibleTrigger>
            <CollapsibleContent>
                <TaskOutput text={task.output} streaming={streaming} open={open} />
            </CollapsibleContent>
        </Collapsible>
    );
}

function TaskOutput({ text, streaming, open }: { text: string; streaming: boolean; open: boolean }) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (open && streaming && ref.current) {
            ref.current.scrollTop = ref.current.scrollHeight;
        }
    }, [open, streaming, text]);

    return (
        <ScrollArea
            viewportRef={ref}
            className="max-h-64 border-t border-border"
            viewportClassName="h-auto max-h-[inherit]"
        >
            <pre className="px-2.5 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-muted-foreground">
                {text}
            </pre>
        </ScrollArea>
    );
}

function taskStatus(task: ToolTaskSnapshot, t: TFunction<"translation">): string {
    if (task.status === "running") {
        return t("rightSidebar.status.running");
    }
    if (task.status === "failed") {
        return t("rightSidebar.status.failed");
    }
    return task.unreadCharacters > 0
        ? t("rightSidebar.status.pendingRead")
        : t("rightSidebar.status.completed");
}
