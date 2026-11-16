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
import { FolderPlus, Plus, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { JarvixProject } from "../../../protocol/project.ts";
import type { JarvixSessionSummary } from "../../../protocol/session.ts";
import { DeleteSessionDialog } from "./DeleteSessionDialog.tsx";
import { NavigationItem } from "./NavigationItem.tsx";
import { RenameSessionDialog } from "./RenameSessionDialog.tsx";
import { Button } from "./ui/button.tsx";
import { SidebarSessionGroup } from "./sidebar/SidebarSessionGroup.tsx";
import { projectGroups } from "./sidebar/session-groups.ts";

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
        <aside className="flex h-full min-h-0 flex-col bg-sidebar">
            <div className="flex items-center gap-2.5 border-b border-border px-5 py-3.5">
                <span className="text-[15px] font-semibold tracking-[0.4px]">Jarvix</span>
            </div>

            <div className="flex min-h-0 flex-1 flex-col p-3">
                <NavigationItem
                    onClick={() => onNewSession()}
                    disabled={busy}
                    icon={<Plus />}
                >
                    {t("sessions.new")}
                </NavigationItem>

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
                    onDragCancel={() => setDraggedSession(null)}
                    onDragEnd={handleDragEnd}
                >
                    <nav
                        aria-label={t("projects.title")}
                        className="-mx-1 mt-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1 py-1"
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
                            />
                        ))}
                    </nav>

                    <DragOverlay dropAnimation={null}>
                        {draggedSession ? (
                            <div className="flex h-full w-full min-w-0 items-center gap-2 rounded-xl border border-border bg-popover px-3 text-sm shadow-lg">
                                <span className="truncate">{draggedSession.name}</span>
                            </div>
                        ) : null}
                    </DragOverlay>
                </DndContext>
            </div>

            <div className="border-t border-border p-3">
                <NavigationItem onClick={onOpenSettings} icon={<Settings />}>
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
