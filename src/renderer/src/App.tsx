import { useCallback, useEffect, useRef, useState } from "react";
import { PanelRightOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDefaultLayout } from "react-resizable-panels";
import { Composer } from "./components/composer/Composer.tsx";
import { CreateProjectDialog } from "./components/projects/CreateProjectDialog.tsx";
import { SandboxSetupDialog } from "./components/sandbox/SandboxSetupDialog.tsx";
import { SettingsDialog } from "./components/settings/SettingsDialog.tsx";
import { Sidebar } from "./components/sidebar/Sidebar.tsx";
import { Transcript } from "./components/transcript/Transcript.tsx";
import { BackgroundTasksSidebar } from "./components/transcript/tools/BackgroundTasksSidebar.tsx";
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
    const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
    const [config, setConfig] = useState<JarvixConfig | null>(null);
    const rightSidebarTriggerRef = useRef<HTMLButtonElement>(null);
    const rightSidebarWasOpen = useRef(false);
    const { defaultLayout, onLayoutChanged } = useDefaultLayout({
        id: LAYOUT_ID,
        onlySaveAfterUserInteractions: true
    });
    const {
        projects,
        sessions,
        archivedSessions,
        sessionContext,
        sessionPermission,
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

    useEffect(() => {
        if (rightSidebarWasOpen.current && !rightSidebarOpen) {
            rightSidebarTriggerRef.current?.focus();
        }
        rightSidebarWasOpen.current = rightSidebarOpen;
    }, [rightSidebarOpen]);

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

    const toggleRightSidebar = useCallback(() => {
        setRightSidebarOpen((open) => !open);
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

                        <ResizablePanel id="content" minSize="50%" style={{ overflow: "hidden" }}>
                            <main className="relative flex h-full min-h-0 min-w-0 flex-col">
                                {!rightSidebarOpen ? (
                                    <Button
                                        ref={rightSidebarTriggerRef}
                                        type="button"
                                        variant="secondary"
                                        size="icon-sm"
                                        aria-label={t("rightSidebar.open")}
                                        title={t("rightSidebar.open")}
                                        onClick={toggleRightSidebar}
                                        data-testid="background-sidebar-open"
                                        className="absolute top-3 right-3 z-10 rounded-lg shadow-sm"
                                    >
                                        <PanelRightOpen />
                                    </Button>
                                ) : null}
                                <Transcript key={activeSessionId ?? "new"} sessionId={activeSessionId} />
                                <Composer
                                    disabled={!bridge || !ready || (busy && !running)}
                                    running={running}
                                    projects={projects}
                                    sessionContext={sessionContext}
                                    sessionPermission={sessionPermission}
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
                    </ResizablePanelGroup>
                </div>
                <BackgroundTasksSidebar
                    open={rightSidebarOpen}
                    sessionId={activeSessionId}
                    onToggle={toggleRightSidebar}
                />
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
