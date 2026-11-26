import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileUp, PanelRightOpen } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { useDefaultLayout } from "react-resizable-panels";
import {
    Composer,
    type ComposerHandle
} from "./components/composer/Composer.tsx";
import { CreateProjectDialog } from "./components/projects/CreateProjectDialog.tsx";
import { ProjectDetailsDialog } from "./components/projects/ProjectDetailsDialog.tsx";
import { RightSidebar } from "./components/right-sidebar/RightSidebar.tsx";
import {
    RIGHT_SIDEBAR_PANEL_ID,
    useRightSidebarLayout
} from "./components/right-sidebar/use-right-sidebar-layout.ts";
import { useRightSidebarTabs } from "./components/right-sidebar/use-right-sidebar-tabs.ts";
import { SandboxSetupDialog } from "./components/sandbox/SandboxSetupDialog.tsx";
import { SettingsDialog } from "./components/settings/SettingsDialog.tsx";
import { Sidebar } from "./components/sidebar/Sidebar.tsx";
import { Transcript } from "./components/transcript/Transcript.tsx";
import { Button } from "./components/ui/button.tsx";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./components/ui/resizable.tsx";
import { useSessions } from "./use-sessions.ts";
import type { JarvixConfig } from "../../protocol/config.ts";
import type { JarvixPathCompletionResult } from "../../protocol/path-completion.ts";
import type { JarvixProject } from "../../protocol/project.ts";
import type { JarvixSessionContext } from "../../protocol/session.ts";
import type { JarvixSkill } from "../../protocol/skill.ts";
import { quickTransition } from "./motion.ts";

const bridge = window.jarvix;

const LAYOUT_ID = "jarvix:main";

export function App() {
    const { t } = useTranslation();
    const [createProjectOpen, setCreateProjectOpen] = useState(false);
    const [detailsProject, setDetailsProject] = useState<JarvixProject | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [config, setConfig] = useState<JarvixConfig | null>(null);
    const [skills, setSkills] = useState<JarvixSkill[]>([]);
    const [draggingFiles, setDraggingFiles] = useState(false);
    const composerRef = useRef<ComposerHandle>(null);
    const dragDepthRef = useRef(0);
    const rightSidebarTabs = useRightSidebarTabs();
    const {
        open: rightSidebarOpen,
        inPanel: rightSidebarInPanel,
        panelIds,
        openSidebar: openRightSidebar,
        closeSidebar: closeRightSidebar,
        triggerRef: rightSidebarTriggerRef
    } = useRightSidebarLayout();
    const { defaultLayout, onLayoutChanged } = useDefaultLayout({
        id: LAYOUT_ID,
        panelIds,
        onlySaveAfterUserInteractions: true
    });
    const {
        projects,
        sessions,
        archivedSessions,
        sessionContext,
        sessionPermission,
        contextUsage,
        goal,
        providerContextRevision,
        permissionRequest,
        activeSessionId,
        busy,
        running,
        ready,
        createProject,
        startNewSession,
        updateSessionContext,
        updateSessionPermission,
        respondPermission,
        renameSession,
        autoNameSession,
        archiveSession,
        unarchiveSession,
        deleteSession,
        moveSessionToProject,
        selectSession,
        send,
        stop,
        submitGoal,
        clearGoal,
        loadSkill
    } = useSessions();

    useEffect(() => {
        if (!bridge) {
            return;
        }
        void bridge.getConfig().then(setConfig).catch(() => undefined);
    }, []);

    const handleSaved = useCallback((next: JarvixConfig) => {
        setConfig(next);
    }, []);

    const handleConfigChange = useCallback(async (next: JarvixConfig) => {
        if (bridge) setConfig(await bridge.setConfig(next));
    }, []);

    const completePaths = useCallback((
        query: string,
        context: JarvixSessionContext
    ): Promise<JarvixPathCompletionResult> => {
        return bridge?.completePaths(query, context) ?? Promise.resolve({
            entries: []
        });
    }, []);

    const addDroppedFiles = useCallback(async (files: readonly File[]): Promise<void> => {
        if (!bridge || !ready || files.length === 0) {
            return;
        }
        const paths: string[] = [];
        for (const file of files.slice(0, 64)) {
            try {
                const path = bridge.pathForFile(file);
                if (path) {
                    paths.push(path);
                }
            } catch {
                continue;
            }
        }
        if (paths.length === 0) {
            return;
        }
        try {
            const result = await bridge.resolvePaths(paths, sessionContext);
            composerRef.current?.addPathMentions(result.entries);
        } catch {}
    }, [ready, sessionContext]);

    useEffect(() => {
        const clearDragState = (): void => {
            dragDepthRef.current = 0;
            setDraggingFiles(false);
        };
        const handleDragEnter = (event: DragEvent): void => {
            if (!isFileDrag(event)) {
                return;
            }
            event.preventDefault();
            dragDepthRef.current += 1;
            if (ready) {
                setDraggingFiles(true);
            }
        };
        const handleDragOver = (event: DragEvent): void => {
            if (!isFileDrag(event)) {
                return;
            }
            event.preventDefault();
            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = "copy";
            }
            if (ready) {
                setDraggingFiles(true);
            }
        };
        const handleDragLeave = (): void => {
            if (dragDepthRef.current === 0) {
                return;
            }
            dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
            if (dragDepthRef.current === 0) {
                clearDragState();
            }
        };
        const handleDrop = (event: DragEvent): void => {
            const files = Array.from(event.dataTransfer?.files ?? []);
            if (files.length === 0) {
                return;
            }
            event.preventDefault();
            clearDragState();
            void addDroppedFiles(files);
        };

        window.addEventListener("dragenter", handleDragEnter);
        window.addEventListener("dragover", handleDragOver);
        window.addEventListener("dragleave", handleDragLeave);
        window.addEventListener("drop", handleDrop);
        window.addEventListener("blur", clearDragState);
        return () => {
            window.removeEventListener("dragenter", handleDragEnter);
            window.removeEventListener("dragover", handleDragOver);
            window.removeEventListener("dragleave", handleDragLeave);
            window.removeEventListener("drop", handleDrop);
            window.removeEventListener("blur", clearDragState);
        };
    }, [addDroppedFiles, ready]);

    const openSettings = useCallback(() => {
        setSettingsOpen(true);
    }, []);

    const skillWorkingDirectories = useMemo(() => {
        if (sessionContext.projectId) {
            return projects.find(
                (project) => project.id === sessionContext.projectId
            )?.workingDirectories ?? [];
        }
        return sessionContext.workingDirectory
            ? [sessionContext.workingDirectory]
            : [];
    }, [projects, sessionContext]);

    useEffect(() => {
        if (!bridge) {
            setSkills([]);
            return;
        }
        let active = true;
        void bridge.listSkills(skillWorkingDirectories, "all")
            .then((next) => {
                if (active) {
                    setSkills(next);
                }
            })
            .catch(() => {
                if (active) {
                    setSkills([]);
                }
            });
        return () => {
            active = false;
        };
    }, [config?.skills, skillWorkingDirectories]);

    const openCreateProject = useCallback(() => {
        setCreateProjectOpen(true);
    }, []);

    const openProjectDetails = useCallback((project: JarvixProject) => {
        setDetailsProject(project);
    }, []);

    return (
        <>
            <div
                data-testid="app-shell"
                data-busy={busy || !ready ? "true" : "false"}
                className="relative flex h-full overflow-hidden"
            >
                <div className="min-w-0 flex-1">
                    <ResizablePanelGroup
                        id={LAYOUT_ID}
                        orientation="horizontal"
                        defaultLayout={defaultLayout}
                        onLayoutChanged={onLayoutChanged}
                    >
                        <ResizablePanel
                            id="sidebar"
                            defaultSize={280}
                            minSize={200}
                            maxSize={320}
                            groupResizeBehavior="preserve-pixel-size"
                            style={{ overflow: "hidden" }}
                        >
                            <Sidebar
                                projects={projects}
                                sessions={sessions}
                                activeSessionId={activeSessionId}
                                busy={busy || !ready}
                                onSelectSession={selectSession}
                                onNewProject={openCreateProject}
                                onNewSession={startNewSession}
                                onMoveSession={moveSessionToProject}
                                onRenameSession={renameSession}
                                onAutoNameSession={autoNameSession}
                                onArchiveSession={archiveSession}
                                onDeleteSession={deleteSession}
                                onOpenProjectDetails={openProjectDetails}
                                onOpenSettings={openSettings}
                            />
                        </ResizablePanel>

                        <ResizableHandle />

                        <ResizablePanel
                            id="content"
                            minSize={360}
                            style={{ overflow: "hidden" }}
                        >
                            <main className="relative flex h-full min-h-0 min-w-0 flex-col bg-background">
                                <AnimatePresence initial={false}>
                                    {!rightSidebarOpen ? (
                                        <motion.div
                                            key="right-sidebar-open"
                                            initial={{ opacity: 0, scale: 0.94 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            exit={{ opacity: 0, scale: 0.94 }}
                                            className="absolute top-3 right-3 z-10"
                                        >
                                            <Button
                                                ref={rightSidebarTriggerRef}
                                                type="button"
                                                variant="ghost"
                                                size="icon-sm"
                                                aria-label={t("rightSidebar.open")}
                                                title={t("rightSidebar.open")}
                                                onClick={openRightSidebar}
                                                data-testid="right-sidebar-open"
                                                className="text-muted-foreground hover:bg-accent hover:text-foreground"
                                            >
                                                <PanelRightOpen />
                                            </Button>
                                        </motion.div>
                                    ) : null}
                                </AnimatePresence>
                                <Transcript key={activeSessionId ?? "new"} sessionId={activeSessionId} />
                                <Composer
                                    ref={composerRef}
                                    disabled={!bridge || !ready || (busy && !running)}
                                    running={running}
                                    projects={projects}
                                    sessionContext={sessionContext}
                                    sessionPermission={sessionPermission}
                                    contextUsage={contextUsage}
                                    goal={goal}
                                    skills={skills}
                                    permissionRequest={permissionRequest}
                                    onSubmit={send}
                                    onGoalSubmit={submitGoal}
                                    onSkillLoad={loadSkill}
                                    onGoalClear={clearGoal}
                                    onStop={stop}
                                    config={config}
                                    onConfigChange={handleConfigChange}
                                    onContextChange={updateSessionContext}
                                    onPermissionChange={updateSessionPermission}
                                    onPermissionResponse={respondPermission}
                                    onPathComplete={completePaths}
                                />
                            </main>
                        </ResizablePanel>

                        {rightSidebarInPanel ? (
                            <>
                                <ResizableHandle data-testid="right-sidebar-resize-handle" />
                                <ResizablePanel
                                    id={RIGHT_SIDEBAR_PANEL_ID}
                                    defaultSize={480}
                                    minSize={320}
                                    maxSize={720}
                                    groupResizeBehavior="preserve-pixel-size"
                                    style={{ overflow: "hidden" }}
                                >
                                    <RightSidebar
                                        variant="panel"
                                        tabs={rightSidebarTabs}
                                        sessionId={activeSessionId}
                                        providerContextRevision={providerContextRevision}
                                        onClose={closeRightSidebar}
                                    />
                                </ResizablePanel>
                            </>
                        ) : null}
                    </ResizablePanelGroup>
                </div>
                <AnimatePresence>
                    {rightSidebarOpen && !rightSidebarInPanel ? (
                        <RightSidebar
                            key="right-sidebar-overlay"
                            variant="overlay"
                            tabs={rightSidebarTabs}
                            sessionId={activeSessionId}
                            providerContextRevision={providerContextRevision}
                            onClose={closeRightSidebar}
                        />
                    ) : null}
                </AnimatePresence>
            </div>

            <AnimatePresence>
                {draggingFiles ? (
                    <motion.div
                        key="file-drop-overlay"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={quickTransition}
                        className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center bg-black/35 p-6 dark:bg-black/55"
                        data-testid="file-drop-overlay"
                    >
                        <div className="flex max-w-md items-center gap-3 rounded-2xl border border-dashed border-border-strong bg-popover px-6 py-4 shadow-[0_8px_28px_rgb(0_0_0/0.08)] dark:shadow-[0_12px_32px_rgb(0_0_0/0.4)]">
                            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground">
                                <FileUp className="size-5" />
                            </div>
                            <p className="text-sm font-medium text-foreground">
                                {t("composer.paths.drop.title")}
                            </p>
                        </div>
                    </motion.div>
                ) : null}
            </AnimatePresence>

            <CreateProjectDialog
                open={createProjectOpen}
                onOpenChange={setCreateProjectOpen}
                onCreate={createProject}
            />

            <SettingsDialog
                open={settingsOpen}
                onOpenChange={setSettingsOpen}
                config={config}
                onSaved={handleSaved}
                archivedSessions={archivedSessions}
                onUnarchiveSession={unarchiveSession}
            />

            <ProjectDetailsDialog
                project={detailsProject}
                open={detailsProject !== null}
                config={config}
                onOpenChange={(open) => {
                    if (!open) {
                        setDetailsProject(null);
                    }
                }}
                onSaved={handleSaved}
            />

            <SandboxSetupDialog />
        </>
    );
}

function isFileDrag(event: DragEvent): boolean {
    return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}
