import { useCallback, useEffect, useState } from "react";
import { useDefaultLayout } from "react-resizable-panels";
import { Composer } from "./components/Composer.tsx";
import { SettingsDialog } from "./components/SettingsDialog.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { Transcript } from "./components/Transcript.tsx";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./components/ui/resizable.tsx";
import { beginTurn, failRequest, ingest } from "./transcript-store.ts";
import type { JarvixConfig } from "../../protocol/config.ts";

const bridge = window.jarvix;

const LAYOUT_ID = "jarvix:main";

export function App() {
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [config, setConfig] = useState<JarvixConfig | null>(null);
    const { defaultLayout, onLayoutChanged } = useDefaultLayout({
        id: LAYOUT_ID,
        onlySaveAfterUserInteractions: true
    });

    useEffect(() => {
        if (!bridge) {
            return;
        }
        void bridge.getConfig().then(setConfig);
        return bridge.onEvents((events) => {
            ingest(events);
        });
    }, []);

    const handleSaved = useCallback((next: JarvixConfig) => {
        setConfig(next);
    }, []);

    const openSettings = useCallback(() => {
        setSettingsOpen(true);
    }, []);

    const send = useCallback(
        async (question: string) => {
            if (!bridge || busy) {
                return;
            }

            beginTurn(question);
            setBusy(true);

            try {
                await bridge.request(question);
            } catch (error) {
                failRequest(error instanceof Error ? error.message : String(error));
            } finally {
                setBusy(false);
            }
        },
        [busy]
    );

    return (
        <>
            <div className="h-full overflow-hidden">
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
                        <Sidebar onOpenSettings={openSettings} />
                    </ResizablePanel>

                    <ResizableHandle />

                    <ResizablePanel id="content" minSize="50%" style={{ overflow: "hidden" }}>
                        <main className="flex h-full min-h-0 min-w-0 flex-col">
                            <Transcript />
                            <Composer disabled={!bridge || busy} onSubmit={send} />
                        </main>
                    </ResizablePanel>
                </ResizablePanelGroup>
            </div>

            <SettingsDialog
                open={settingsOpen}
                onOpenChange={setSettingsOpen}
                config={config}
                onSaved={handleSaved}
            />
        </>
    );
}
