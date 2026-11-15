import { useCallback, useEffect, useState } from "react";
import { PanelRightOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDefaultLayout } from "react-resizable-panels";
import { Composer } from "./components/Composer.tsx";
import { CreateProjectDialog } from "./components/CreateProjectDialog.tsx";
import { RightSidebar } from "./components/RightSidebar.tsx";
import { SettingsDialog } from "./components/SettingsDialog.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { Transcript } from "./components/Transcript.tsx";
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
    const [rightSidebarOpen, setRightSidebarOpen] = useState(true);
    const [config, setConfig] = useState<JarvixConfig | null>(null);
    const { defaultLayout, onLayoutChanged } = useDefaultLayout({
        id: LAYOUT_ID,
        onlySaveAfterUserInteractions: true
    });
    const {
        projects,
        sessions,
        sessionContext,
        activeSessionId,
        busy,
        ready,
        createProject,
        startNewSession,
        updateSessionContext,
        moveSessionToProject,
        selectSession,
        send
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

    const toggleRightSidebar = useCallback(() => {
        setRightSidebarOpen((open) => !open);
    }, []);

    return (
        <>
            <div className="flex h-full overflow-hidden">
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
                                onOpenSettings={openSettings}
                            />
                        </ResizablePanel>

                        <ResizableHandle />

                        <ResizablePanel id="content" minSize="50%" style={{ overflow: "hidden" }}>
                            <main className="relative flex h-full min-h-0 min-w-0 flex-col">
                                {!rightSidebarOpen ? (
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        size="icon-sm"
                                        aria-label={t("rightSidebar.open")}
                                        title={t("rightSidebar.open")}
                                        onClick={toggleRightSidebar}
                                        className="absolute top-3 right-3 z-10 rounded-lg shadow-sm"
                                    >
                                        <PanelRightOpen />
                                    </Button>
                                ) : null}
                                <Transcript key={activeSessionId ?? "new"} sessionId={activeSessionId} />
                                <Composer
                                    disabled={!bridge || !ready || busy}
                                    projects={projects}
                                    sessionContext={sessionContext}
                                    onSubmit={send}
                                    config={config}
                                    onConfigChange={handleConfigChange}
                                    onContextChange={updateSessionContext}
                                />
                            </main>
                        </ResizablePanel>
                    </ResizablePanelGroup>
                </div>
                <RightSidebar
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
            />
        </>
    );
}
