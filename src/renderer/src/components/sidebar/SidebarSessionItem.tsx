import { useDraggable } from "@dnd-kit/core";
import { Archive, Pencil, Sparkles, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { cn } from "cn";
import type { JarvixSessionSummary } from "../../../../protocol/session.ts";
import { layoutSpring } from "../../motion.ts";
import { Button } from "../ui/button.tsx";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger
} from "../ui/context-menu.tsx";

type SidebarSessionItemProps = {
    session: JarvixSessionSummary;
    active: boolean;
    busy: boolean;
    onSelect(sessionId: string): void;
    onRename(session: JarvixSessionSummary): void;
    onAutoName(sessionId: string): void;
    onArchive(sessionId: string): void;
    onRequestDelete(session: JarvixSessionSummary): void;
};

export function SidebarSessionItem({
    session,
    active,
    busy,
    onSelect,
    onRename,
    onAutoName,
    onArchive,
    onRequestDelete
}: SidebarSessionItemProps) {
    const { t } = useTranslation();
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
        id: session.id,
        data: { session },
        disabled: busy
    });

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild disabled={busy}>
                <div
                    ref={setNodeRef}
                    data-session-id={session.id}
                    data-session-status={session.status}
                    data-session-project={session.projectId ?? "temporary"}
                    data-session-working-directory={session.workingDirectory}
                    style={{ opacity: isDragging ? 0.35 : undefined }}
                    className={cn(
                        "group relative flex h-9 w-full items-center overflow-hidden rounded-lg text-sm transition-colors",
                        active
                            ? "font-medium text-accent-foreground"
                            : "text-muted-foreground hover:bg-accent/70 hover:text-foreground"
                    )}
                >
                    {active ? (
                        <motion.span
                            aria-hidden="true"
                            layoutId="active-session-highlight"
                            className="absolute inset-0 rounded-lg bg-accent"
                            transition={layoutSpring}
                        />
                    ) : null}
                    <button
                        type="button"
                        aria-current={active ? "page" : undefined}
                        title={isDragging ? undefined : session.name}
                        onClick={() => onSelect(session.id)}
                        disabled={busy}
                        className="relative z-10 flex h-full min-w-0 flex-1 cursor-grab items-center rounded-lg pr-1.5 pl-8 text-left text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring/25 active:cursor-grabbing"
                        {...attributes}
                        {...listeners}
                    >
                        <span className="min-w-0 flex-1 truncate">{session.name}</span>
                    </button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t("sessions.archive")}
                        title={t("sessions.archive")}
                        disabled={busy}
                        onClick={() => onArchive(session.id)}
                        className="relative z-10 mr-1 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100"
                    >
                        <Archive />
                    </Button>
                </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-44">
                <ContextMenuItem onSelect={() => onRename(session)}>
                    <Pencil />
                    {t("sessions.rename")}
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => onAutoName(session.id)}>
                    <Sparkles />
                    {t("sessions.autoName")}
                </ContextMenuItem>
                <ContextMenuItem
                    className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                    onSelect={() => onRequestDelete(session)}
                >
                    <Trash2 />
                    {t("sessions.delete")}
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
}
