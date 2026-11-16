import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { ChevronRight, Folder, Inbox, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "cn";
import type { JarvixSessionSummary } from "../../../../protocol/session.ts";
import { Button } from "../ui/button.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible.tsx";
import { SidebarSessionItem } from "./SidebarSessionItem.tsx";
import { dropTargetId, type SessionGroup } from "./session-groups.ts";

type SidebarSessionGroupProps = {
    group: SessionGroup;
    activeSessionId: string | null;
    busy: boolean;
    onSelectSession(sessionId: string): void;
    onNewSession(projectId?: string | null): void;
    onRenameSession(session: JarvixSessionSummary): void;
    onAutoNameSession(sessionId: string): void;
    onArchiveSession(sessionId: string): void;
    onRequestDeleteSession(session: JarvixSessionSummary): void;
};

export function SidebarSessionGroup({
    group,
    activeSessionId,
    busy,
    onSelectSession,
    onNewSession,
    onRenameSession,
    onAutoNameSession,
    onArchiveSession,
    onRequestDeleteSession
}: SidebarSessionGroupProps) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(true);
    const projectId = group.project?.id ?? null;
    const { setNodeRef, isOver } = useDroppable({
        id: dropTargetId(projectId),
        data: { projectId }
    });
    const label = group.project?.name ?? t("projects.temporary");
    const GroupIcon = group.project ? Folder : Inbox;

    return (
        <Collapsible open={open} onOpenChange={setOpen} asChild>
            <section
                ref={setNodeRef}
                className={cn(
                    "relative rounded-lg transition-shadow",
                    isOver && "z-10 ring-2 ring-primary/60 ring-offset-2 ring-offset-sidebar"
                )}
            >
                <div className="flex items-center gap-1">
                    <CollapsibleTrigger asChild>
                        <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium text-foreground outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/50"
                            title={label}
                        >
                            <ChevronRight className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
                            <GroupIcon className="size-4 shrink-0" />
                            <span className="min-w-0 flex-1 truncate">{label}</span>
                        </button>
                    </CollapsibleTrigger>
                    {group.project ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={t("projects.newSessionIn", { name: group.project.name })}
                            title={t("projects.newSession")}
                            onClick={() => onNewSession(group.project!.id)}
                            disabled={busy}
                        >
                            <Plus />
                        </Button>
                    ) : null}
                </div>

                <CollapsibleContent>
                    <div className="flex flex-col gap-0.5 py-0.5">
                        {group.sessions.map((session) => (
                            <SidebarSessionItem
                                key={session.id}
                                session={session}
                                active={session.id === activeSessionId}
                                busy={busy}
                                onSelect={onSelectSession}
                                onRename={onRenameSession}
                                onAutoName={onAutoNameSession}
                                onArchive={onArchiveSession}
                                onRequestDelete={onRequestDeleteSession}
                            />
                        ))}
                    </div>
                </CollapsibleContent>
            </section>
        </Collapsible>
    );
}
