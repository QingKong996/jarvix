import { useEffect, useRef, useState } from "react";
import { ChevronRight, Terminal } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { ToolTaskSnapshot } from "../../../../core/tools/types.ts";
import { useBackgroundTasks } from "../../background-tasks/store.ts";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";

export function BackgroundTasksPanel({ sessionId }: { sessionId: string | null }) {
    const { t } = useTranslation();
    const tasks = useBackgroundTasks(sessionId);

    if (tasks.length === 0) {
        return (
            <div
                data-testid="background-tasks-empty"
                className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center"
            >
                <div className="rounded-2xl border border-border bg-muted/60 p-3 text-muted-foreground">
                    <Terminal className="size-5" />
                </div>
                <p className="text-xs text-muted-foreground">
                    {t("rightSidebar.empty")}
                </p>
            </div>
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
                <span className="shrink-0 text-xs text-muted-foreground">
                    {taskStatus(task, t)}
                </span>
            </CollapsibleTrigger>
            <CollapsibleContent>
                <TaskOutput
                    text={task.output}
                    truncatedCharacters={task.truncatedCharacters}
                    streaming={streaming}
                    open={open}
                />
            </CollapsibleContent>
        </Collapsible>
    );
}

function TaskOutput({ text, truncatedCharacters, streaming, open }: {
    text: string;
    truncatedCharacters: number;
    streaming: boolean;
    open: boolean;
}) {
    const { t } = useTranslation();
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
            {truncatedCharacters > 0 ? (
                <p className="sticky top-0 border-b border-border bg-background/95 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                    {t("rightSidebar.outputTruncated", {
                        characters: truncatedCharacters.toLocaleString()
                    })}
                </p>
            ) : null}
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
