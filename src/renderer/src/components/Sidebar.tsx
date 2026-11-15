import { useState } from "react";
import {
    DndContext,
    DragOverlay,
    PointerSensor,
    pointerWithin,
    useDraggable,
    useDroppable,
    useSensor,
    useSensors,
    type DragEndEvent,
    type DragStartEvent
} from "@dnd-kit/core";
import {
    ChevronRight,
    Folder,
    FolderPlus,
    Inbox,
    MessageSquare,
    Pencil,
    Plus,
    Settings,
    Sparkles
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { JarvixProject } from "../../../protocol/project.ts";
import type { JarvixSessionSummary } from "../../../protocol/session.ts";
import { RenameSessionDialog } from "./RenameSessionDialog.tsx";
import { Button } from "./ui/button.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible.tsx";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger
} from "./ui/context-menu.tsx";

type SidebarProps = {
    projects: JarvixProject[];
    sessions: JarvixSessionSummary[];
    activeSessionId: string | null;
    busy: boolean;
    onSelectSession(sessionId: string): void;
    onNewProject(): void;
    onNewSession(projectId?: string | null): void;
    onMoveSession(sessionId: string, projectId: string | null): void;
    onRenameSession(sessionId: string, name: string): Promise<boolean>;
    onAutoNameSession(sessionId: string): Promise<boolean>;
    onOpenSettings(): void;
};

type SessionGroup = {
    key: string;
    project: JarvixProject | null;
    sessions: JarvixSessionSummary[];
    latestAt: number;
};

function navItemClass(active: boolean): string {
    return `flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
    }`;
}

function sessionItemClass(active: boolean): string {
    return `flex w-full items-center gap-2 rounded-md py-2 pr-3 pl-9 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
    }`;
}

function dropTargetId(projectId: string | null): string {
    return projectId ? `project:${projectId}` : "temporary";
}

function projectGroups(projects: JarvixProject[], sessions: JarvixSessionSummary[]): SessionGroup[] {
    const groups = new Map<string, SessionGroup>();
    for (const project of projects) {
        groups.set(project.id, {
            key: project.id,
            project,
            sessions: [],
            latestAt: project.createdAt
        });
    }

    const temporary: SessionGroup = {
        key: "temporary",
        project: null,
        sessions: [],
        latestAt: 0
    };

    for (const session of sessions) {
        const group = session.projectId ? groups.get(session.projectId) : undefined;
        (group ?? temporary).sessions.push(session);
    }

    if (temporary.sessions.length > 0) {
        groups.set(temporary.key, temporary);
    }

    return [...groups.values()]
        .map((group) => {
            const sessions = [...group.sessions].sort(
                (left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt
            );
            return {
                ...group,
                sessions,
                latestAt: sessions[0]?.updatedAt ?? group.latestAt
            };
        })
        .sort((left, right) => right.latestAt - left.latestAt || left.key.localeCompare(right.key));
}

function SessionItem({
    session,
    active,
    busy,
    onSelect,
    onRename,
    onAutoName
}: {
    session: JarvixSessionSummary;
    active: boolean;
    busy: boolean;
    onSelect(sessionId: string): void;
    onRename(session: JarvixSessionSummary): void;
    onAutoName(sessionId: string): void;
}) {
    const { t } = useTranslation();
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
        id: session.id,
        data: { session },
        disabled: busy
    });

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild disabled={busy}>
                <button
                    ref={setNodeRef}
                    type="button"
                    aria-current={active ? "page" : undefined}
                    title={session.name}
                    onClick={() => onSelect(session.id)}
                    disabled={busy}
                    style={{ opacity: isDragging ? 0.35 : undefined }}
                    className={`${sessionItemClass(active)} cursor-grab active:cursor-grabbing`}
                    {...attributes}
                    {...listeners}
                >
                    <MessageSquare className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{session.name}</span>
                </button>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-44">
                <ContextMenuItem onSelect={() => onRename(session)}>
                    <Pencil />
                    {t("sessions.rename")}
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => void onAutoName(session.id)}>
                    <Sparkles />
                    {t("sessions.autoName")}
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
}

function SessionGroupView({
    group,
    activeSessionId,
    busy,
    onSelectSession,
    onNewSession,
    onRenameSession,
    onAutoNameSession
}: {
    group: SessionGroup;
    activeSessionId: string | null;
    busy: boolean;
    onSelectSession(sessionId: string): void;
    onNewSession(projectId?: string | null): void;
    onRenameSession(session: JarvixSessionSummary): void;
    onAutoNameSession(sessionId: string): void;
}) {
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
                className={`rounded-lg transition-shadow ${isOver ? "ring-2 ring-primary/40" : ""}`}
            >
                <div className="flex items-center gap-1">
                    <CollapsibleTrigger asChild>
                        <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium text-foreground hover:bg-accent/50"
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
                            <SessionItem
                                key={session.id}
                                session={session}
                                active={session.id === activeSessionId}
                                busy={busy}
                                onSelect={onSelectSession}
                                onRename={onRenameSession}
                                onAutoName={onAutoNameSession}
                            />
                        ))}
                    </div>
                </CollapsibleContent>
            </section>
        </Collapsible>
    );
}

export function Sidebar({
    projects,
    sessions,
    activeSessionId,
    busy,
    onSelectSession,
    onNewProject,
    onNewSession,
    onMoveSession,
    onRenameSession,
    onAutoNameSession,
    onOpenSettings
}: SidebarProps) {
    const { t } = useTranslation();
    const [activeSession, setActiveSession] = useState<JarvixSessionSummary | null>(null);
    const sensors = useSensors(useSensor(PointerSensor, {
        activationConstraint: { distance: 6 }
    }));
    const groups = projectGroups(projects, sessions);
    const knownProjectIds = new Set(projects.map((project) => project.id));
    const [renameTarget, setRenameTarget] = useState<JarvixSessionSummary | null>(null);

    function handleDragStart(event: DragStartEvent): void {
        const session = event.active.data.current?.session;
        if (isSessionSummary(session)) {
            setActiveSession(session);
        }
    }

    function handleDragEnd(event: DragEndEvent): void {
        setActiveSession(null);
        const session = event.active.data.current?.session;
        const targetProjectId = event.over?.data.current?.projectId;
        if (!isSessionSummary(session) || (targetProjectId !== null && typeof targetProjectId !== "string")) {
            return;
        }

        const currentProjectId = session.projectId && knownProjectIds.has(session.projectId)
            ? session.projectId
            : null;
        if (currentProjectId !== targetProjectId) {
            onMoveSession(session.id, targetProjectId);
        }
    }

    return (
        <aside className="flex h-full min-h-0 flex-col bg-secondary/20">
            <div className="flex items-center gap-2.5 border-b border-border px-5 py-3.5">
                <span className="text-[15px] font-semibold tracking-[0.4px]">Jarvix</span>
            </div>

            <div className="flex min-h-0 flex-1 flex-col p-3">
                <button
                    type="button"
                    onClick={() => onNewSession()}
                    disabled={busy}
                    className={navItemClass(false)}
                >
                    <Plus className="size-4" />
                    {t("sessions.new")}
                </button>

                <div className="mt-5 flex items-center justify-between pl-3">
                    <p className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                        {t("projects.title")}
                    </p>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t("projects.new")}
                        title={t("projects.new")}
                        onClick={onNewProject}
                        disabled={busy}
                    >
                        <FolderPlus />
                    </Button>
                </div>

                <DndContext
                    sensors={sensors}
                    collisionDetection={pointerWithin}
                    onDragStart={handleDragStart}
                    onDragCancel={() => setActiveSession(null)}
                    onDragEnd={handleDragEnd}
                >
                    <nav
                        aria-label={t("projects.title")}
                        className="mt-2 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto"
                    >
                        {groups.length === 0 ? (
                            <p className="px-3 py-2 text-xs text-muted-foreground">{t("projects.empty")}</p>
                        ) : groups.map((group) => (
                            <SessionGroupView
                                key={group.key}
                                group={group}
                                activeSessionId={activeSessionId}
                                busy={busy}
                                onSelectSession={onSelectSession}
                                onNewSession={onNewSession}
                                onRenameSession={setRenameTarget}
                                onAutoNameSession={(sessionId) => {
                                    void onAutoNameSession(sessionId);
                                }}
                            />
                        ))}
                    </nav>

                    <DragOverlay dropAnimation={null}>
                        {activeSession ? (
                            <div className="flex max-w-64 items-center gap-2 rounded-md border bg-popover px-3 py-2 text-sm shadow-lg">
                                <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
                                <span className="truncate">{activeSession.name}</span>
                            </div>
                        ) : null}
                    </DragOverlay>
                </DndContext>
            </div>

            <div className="border-t border-border p-3">
                <button type="button" onClick={onOpenSettings} className={navItemClass(false)}>
                    <Settings className="size-4" />
                    {t("nav.settings")}
                </button>
            </div>

            <RenameSessionDialog
                session={renameTarget}
                onOpenChange={(open) => {
                    if (!open) {
                        setRenameTarget(null);
                    }
                }}
                onRename={onRenameSession}
            />
        </aside>
    );
}

function isSessionSummary(value: unknown): value is JarvixSessionSummary {
    return (
        typeof value === "object" &&
        value !== null &&
        "id" in value &&
        typeof value.id === "string" &&
        "name" in value &&
        typeof value.name === "string" &&
        "updatedAt" in value &&
        typeof value.updatedAt === "number"
    );
}
