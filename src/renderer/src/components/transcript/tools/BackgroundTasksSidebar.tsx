import { useEffect, useRef, useState } from "react";
import { ChevronRight, PanelRightClose, Terminal } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { cn } from "cn";
import type { ToolTaskSnapshot } from "../../../../../core/tools/types.ts";
import { useBackgroundTasks } from "./background-task-store.ts";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";

type BackgroundTasksSidebarProps = {
    open: boolean;
    sessionId: string | null;
    onToggle(): void;
};

export function BackgroundTasksSidebar({ open, sessionId, onToggle }: BackgroundTasksSidebarProps) {
    const { t } = useTranslation();

    useEffect(() => {
        if (!open) return;
        const handleKeyDown = (event: KeyboardEvent): void => {
            if (event.key === "Escape") onToggle();
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [open, onToggle]);

    if (!open) {
        return null;
    }

    return (
        <>
            <div
                aria-hidden="true"
                onClick={onToggle}
                className="fixed inset-0 z-20 bg-background/70 backdrop-blur-[1px] xl:hidden"
            />
            <aside
                aria-labelledby="background-tasks-title"
                data-testid="background-sidebar"
                className="fixed inset-y-0 right-0 z-30 flex h-full w-[min(20rem,calc(100vw-2rem))] shrink-0 flex-col border-l border-border bg-popover shadow-xl xl:static xl:z-auto xl:w-80 xl:shadow-none"
            >
                <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                        <Terminal className="size-4 shrink-0 text-muted-foreground" />
                        <h2 id="background-tasks-title" className="truncate text-sm font-medium">
                            {t("rightSidebar.tabs.background")}
                        </h2>
                    </div>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        autoFocus
                        aria-label={t("rightSidebar.close")}
                        title={t("rightSidebar.close")}
                        onClick={onToggle}
                        data-testid="background-sidebar-close"
                        className="shrink-0"
                    >
                        <PanelRightClose />
                    </Button>
                </header>

                <BackgroundTaskList sessionId={sessionId} />
            </aside>
        </>
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
                className="group flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
                <code className="min-w-0 flex-1 truncate font-mono text-xs">
                    {task.command}
                </code>
                <span className={cn(
                    "shrink-0 text-xs text-muted-foreground",
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
            <pre className="px-2.5 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-muted-foreground">
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
