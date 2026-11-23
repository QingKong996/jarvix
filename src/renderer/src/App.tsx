import { useCallback, useEffect, useState } from "react";
import { PanelRightOpen } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { useDefaultLayout } from "react-resizable-panels";
import { Composer } from "./components/composer/Composer.tsx";
import { CreateProjectDialog } from "./components/projects/CreateProjectDialog.tsx";
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

const bridge = window.jarvix;

const LAYOUT_ID = "jarvix:main";

export function App() {
    const { t } = useTranslation();
    const [createProjectOpen, setCreateProjectOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [config, setConfig] = useState<JarvixConfig | null>(null);
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
        stop
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

    const openSettings = useCallback(() => {
        setSettingsOpen(true);
    }, []);

    const openCreateProject = useCallback(() => {
        setCreateProjectOpen(true);
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
                                onOpenSettings={openSettings}
                            />
                        </ResizablePanel>

                        <ResizableHandle />

                        <ResizablePanel
                            id="content"
                            minSize={360}
                            style={{ overflow: "hidden" }}
                        >
                            <main className="relative flex h-full min-h-0 min-w-0 flex-col">
                                <AnimatePresence initial={false}>
                                    {!rightSidebarOpen ? (
                                        <motion.div
                                            key="right-sidebar-open"
                                            initial={{ opacity: 0, scale: 0.88 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            exit={{ opacity: 0, scale: 0.88 }}
                                            className="absolute top-3 right-3 z-10"
                                        >
                                            <Button
                                                ref={rightSidebarTriggerRef}
                                                type="button"
                                                variant="secondary"
                                                size="icon-sm"
                                                aria-label={t("rightSidebar.open")}
                                                title={t("rightSidebar.open")}
                                                onClick={openRightSidebar}
                                                data-testid="right-sidebar-open"
                                                className="rounded-lg shadow-sm"
                                            >
                                                <PanelRightOpen />
                                            </Button>
                                        </motion.div>
                                    ) : null}
                                </AnimatePresence>
                                <Transcript key={activeSessionId ?? "new"} sessionId={activeSessionId} />
                                <Composer
                                    disabled={!bridge || !ready || (busy && !running)}
                                    running={running}
                                    projects={projects}
                                    sessionContext={sessionContext}
                                    sessionPermission={sessionPermission}
                                    contextUsage={contextUsage}
                                    permissionRequest={permissionRequest}
                                    onSubmit={send}
                                    onStop={stop}
                                    config={config}
                                    onConfigChange={handleConfigChange}
                                    onContextChange={updateSessionContext}
                                    onPermissionChange={updateSessionPermission}
                                    onPermissionResponse={respondPermission}
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

            <SandboxSetupDialog />
        </>
    );
}
