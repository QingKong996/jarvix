import { useState } from "react";
import {
    DndContext,
    DragOverlay,
    PointerSensor,
    pointerWithin,
    useSensor,
    useSensors,
    type DragEndEvent,
    type DragStartEvent
} from "@dnd-kit/core";
import { FolderPlus, Plus, Settings, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { JarvixProject } from "../../../../protocol/project.ts";
import type { JarvixSessionSummary } from "../../../../protocol/session.ts";
import { NavigationItem } from "../common/NavigationItem.tsx";
import { DeleteSessionDialog } from "../sessions/DeleteSessionDialog.tsx";
import { RenameSessionDialog } from "../sessions/RenameSessionDialog.tsx";
import { Button } from "../ui/button.tsx";
import { SidebarSessionGroup } from "./SidebarSessionGroup.tsx";
import { projectGroups } from "./session-groups.ts";

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
    onArchiveSession(sessionId: string): Promise<boolean>;
    onDeleteSession(sessionId: string): Promise<boolean>;
    onOpenProjectDetails(project: JarvixProject): void;
    onOpenSettings(): void;
};

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
    onArchiveSession,
    onDeleteSession,
    onOpenProjectDetails,
    onOpenSettings
}: SidebarProps) {
    const { t } = useTranslation();
    const [draggedSession, setDraggedSession] = useState<JarvixSessionSummary | null>(null);
    const [renameTarget, setRenameTarget] = useState<JarvixSessionSummary | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<JarvixSessionSummary | null>(null);
    const sensors = useSensors(useSensor(PointerSensor, {
        activationConstraint: { distance: 6 }
    }));
    const groups = projectGroups(projects, sessions);
    const knownProjectIds = new Set(projects.map((project) => project.id));

    function handleDragStart(event: DragStartEvent): void {
        const session = event.active.data.current?.session;
        if (isSessionSummary(session)) {
            setDraggedSession(session);
        }
    }

    function handleDragEnd(event: DragEndEvent): void {
        setDraggedSession(null);
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
        <aside data-testid="session-sidebar" className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
            <div className="flex h-14 shrink-0 items-center justify-between px-4">
                <span className="text-[15px] font-semibold tracking-tight text-foreground">Jarvix</span>
            </div>

            <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
                <NavigationItem
                    onClick={() => onNewSession()}
                    disabled={busy}
                    icon={<Plus />}
                    data-testid="new-session"
                    className="font-medium text-foreground"
                >
                    {t("sessions.new")}
                </NavigationItem>

                <div className="mt-5 flex items-center justify-between px-2.5">
                    <p className="text-xs font-medium text-muted-foreground">
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
                        data-testid="new-project"
                        className="text-muted-foreground hover:text-foreground"
                    >
                        <FolderPlus />
                    </Button>
                </div>

                <DndContext
                    sensors={sensors}
                    collisionDetection={pointerWithin}
                    onDragStart={handleDragStart}
                    onDragCancel={() => setDraggedSession(null)}
                    onDragEnd={handleDragEnd}
                >
                    <nav
                        aria-label={t("projects.title")}
                        className="-mx-0.5 mt-1.5 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-0.5 py-0.5"
                    >
                        {groups.length === 0 ? (
                            <p className="px-3 py-2 text-xs text-muted-foreground">{t("projects.empty")}</p>
                        ) : groups.map((group) => (
                            <SidebarSessionGroup
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
                                onArchiveSession={(sessionId) => {
                                    void onArchiveSession(sessionId);
                                }}
                                onRequestDeleteSession={setDeleteTarget}
                                onOpenProjectDetails={onOpenProjectDetails}
                            />
                        ))}
                    </nav>

                    <DragOverlay dropAnimation={null}>
                        {draggedSession ? (
                            <div className="flex h-full w-full min-w-0 items-center gap-2 rounded-xl border border-border-strong bg-popover px-3.5 text-sm text-popover-foreground shadow-[0_6px_20px_rgb(0_0_0/0.06)] dark:shadow-[0_8px_24px_rgb(0_0_0/0.36)]">
                                <span className="truncate">{draggedSession.name}</span>
                            </div>
                        ) : null}
                    </DragOverlay>
                </DndContext>
            </div>

            <div className="border-t border-border/70 p-3">
                <NavigationItem onClick={onOpenSettings} icon={<Settings />} data-testid="open-settings">
                    {t("nav.settings")}
                </NavigationItem>
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

            <DeleteSessionDialog
                session={deleteTarget}
                onOpenChange={(open) => {
                    if (!open) {
                        setDeleteTarget(null);
                    }
                }}
                onDelete={onDeleteSession}
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
