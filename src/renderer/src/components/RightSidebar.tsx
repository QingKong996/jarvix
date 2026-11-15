import { useEffect, useRef, useState } from "react";
import {
    ChevronRight,
    PanelRightClose,
    Terminal,
    X
} from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { cn } from "cn";
import type { ToolTaskSnapshot } from "../../../tools/types.ts";
import { useBackgroundTasks } from "../background-task-store.ts";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
        return null;
    }

    return (
        <aside className="flex h-full w-80 shrink-0 flex-col border-l border-border bg-secondary/20">
            <Tabs
                value={activeTab}
                onValueChange={(value) => setActiveTab(value as TabId)}
                className="min-h-0 flex-1 gap-0"
            >
                <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2">
                    <div className="relative flex min-w-0 flex-1">
                        <TabsList className="h-8 min-w-0 flex-1 justify-start rounded-none bg-transparent p-0">
                            {TABS.map((tab) => {
                                const Icon = tab.icon;
                                return (
                                    <TabsTrigger
                                        key={tab.id}
                                        value={tab.id}
                                        className="h-full min-w-0 justify-start gap-2 rounded-lg border-border bg-accent/40 pr-8 text-xs shadow-xs data-[state=active]:bg-accent/70"
                                    >
                                        <Icon className="size-3.5" />
                                        <span className="truncate">{t(tab.labelKey)}</span>
                                    </TabsTrigger>
                                );
                            })}
                        </TabsList>
                        <button
                            type="button"
                            aria-label={t("rightSidebar.close")}
                            title={t("rightSidebar.close")}
                            onClick={onToggle}
                            className="absolute top-1/2 right-1 z-10 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground opacity-70 transition-colors hover:text-foreground hover:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                        >
                            <X className="size-3.5" />
                        </button>
                    </div>
                    <Button
                        type="button"
                        variant="secondary"
                        size="icon-sm"
                        aria-label={t("rightSidebar.close")}
                        title={t("rightSidebar.close")}
                        onClick={onToggle}
                        className="shrink-0 rounded-lg"
                    >
                        <PanelRightClose />
                    </Button>
                </header>

                <div className="flex min-h-0 flex-1 flex-col">
                    {activeTab === "background" ? (
                        <TabsContent value="background" className="flex min-h-0 flex-col">
                            <BackgroundTaskList sessionId={sessionId} />
                        </TabsContent>
                    ) : null}
                </div>
            </Tabs>
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
