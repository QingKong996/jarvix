import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { ChevronRight, Folder, Inbox, Plus } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { cn } from "cn";
import type { JarvixSessionSummary } from "../../../../protocol/session.ts";
import { quickTransition, smoothTransition } from "../../motion.ts";
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
                data-project-group={projectId ?? "temporary"}
                className={cn(
                    "relative rounded-xl transition-colors",
                    isOver && "z-10 bg-accent/60 ring-1 ring-foreground/25"
                )}
            >
                <div className="flex items-center gap-0.5">
                    <CollapsibleTrigger asChild>
                        <button
                            type="button"
                            className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 text-left text-sm font-medium text-foreground outline-none transition-colors hover:bg-accent/70 focus-visible:ring-2 focus-visible:ring-ring/25"
                            title={label}
                        >
                            <motion.span
                                aria-hidden="true"
                                animate={{ rotate: open ? 90 : 0 }}
                                transition={quickTransition}
                                className="inline-flex shrink-0 text-muted-foreground"
                            >
                                <ChevronRight className="size-3.5" />
                            </motion.span>
                            <GroupIcon className="size-4 shrink-0 text-muted-foreground" />
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
                            className="text-muted-foreground hover:text-foreground"
                        >
                            <Plus />
                        </Button>
                    ) : null}
                </div>

                <CollapsibleContent asChild>
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        transition={smoothTransition}
                        className="overflow-hidden"
                    >
                        <div className="flex flex-col gap-0.5 py-0.5">
                            {group.sessions.map((session) => (
                                <motion.div
                                    key={session.id}
                                    layout="position"
                                    initial={{ opacity: 0, y: -4 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={quickTransition}
                                >
                                    <SidebarSessionItem
                                        session={session}
                                        active={session.id === activeSessionId}
                                        busy={busy}
                                        onSelect={onSelectSession}
                                        onRename={onRenameSession}
                                        onAutoName={onAutoNameSession}
                                        onArchive={onArchiveSession}
                                        onRequestDelete={onRequestDeleteSession}
                                    />
                                </motion.div>
                            ))}
                        </div>
                    </motion.div>
                </CollapsibleContent>
            </section>
        </Collapsible>
    );
}
