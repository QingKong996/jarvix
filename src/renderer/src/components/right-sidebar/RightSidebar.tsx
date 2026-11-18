import { useEffect, useReducer, useRef } from "react";
import { Globe, PanelRightClose, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "cn";
import { ContextInspector } from "../context-inspector/ContextInspector.tsx";
import { BackgroundTasksPanel } from "./BackgroundTasksPanel.tsx";
import { rightSidebarPanel, type RightSidebarPanel } from "./panel-registry.ts";
import { RightSidebarNewTab } from "./RightSidebarNewTab.tsx";
import {
    activeSidebarTab,
    createSidebarTabsState,
    sidebarTabsReducer
} from "./sidebar-tabs.ts";
import { Button } from "@/components/ui/button";

type RightSidebarProps = {
    open: boolean;
    sessionId: string | null;
    providerContextRevision: number;
    onToggle(): void;
};

export function RightSidebar({
    open,
    sessionId,
    providerContextRevision,
    onToggle
}: RightSidebarProps) {
    const { t } = useTranslation();
    const [tabState, dispatch] = useReducer(
        sidebarTabsReducer,
        undefined,
        createSidebarTabsState
    );
    const tabIdRef = useRef(0);

    useEffect(() => {
        if (!open) return;
        const handleKeyDown = (event: KeyboardEvent): void => {
            if (event.key === "Escape") onToggle();
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [open, onToggle]);

    if (!open) {
        return null;
    }

    const activeTab = activeSidebarTab(tabState);
    const nextTabId = (): string => `right-sidebar-tab-${++tabIdRef.current}`;

    const addTab = (): void => {
        dispatch({ type: "new", id: nextTabId() });
    };

    const openPanel = (panel: RightSidebarPanel): void => {
        dispatch({ type: "open", panel, newTabId: nextTabId() });
    };

    const closeTab = (tabId: string): void => {
        dispatch({ type: "close", id: tabId, fallbackId: nextTabId() });
    };

    return (
        <>
            <div
                aria-hidden="true"
                onClick={onToggle}
                className="fixed inset-0 z-20 bg-background/70 xl:hidden"
            />
            <aside
                aria-labelledby="right-sidebar-title"
                data-testid="right-sidebar"
                className="fixed inset-y-0 right-0 z-30 flex h-full w-[min(30rem,calc(100vw-2rem))] shrink-0 flex-col border-l border-border bg-popover shadow-xl xl:static xl:z-auto xl:w-[30rem] xl:shadow-none 2xl:w-[34rem]"
            >
                <h2 id="right-sidebar-title" className="sr-only">
                    {t("rightSidebar.title")}
                </h2>
                <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-2">
                    <div
                        role="tablist"
                        aria-label={t("rightSidebar.title")}
                        className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    >
                        {tabState.tabs.map((tab) => {
                            const active = tab.id === activeTab.id;
                            const definition = tab.panel
                                ? rightSidebarPanel(tab.panel)
                                : null;
                            const label = definition
                                ? t(definition.labelKey)
                                : t("rightSidebar.newTab");
                            const Icon = definition?.icon ?? Globe;
                            return (
                                <div
                                    key={tab.id}
                                    role="presentation"
                                    className={cn(
                                        "flex h-8 min-w-30 max-w-52 shrink-0 items-center rounded-[10px] border pr-1 pl-2.5",
                                        active
                                            ? "border-border bg-muted/70 text-foreground"
                                            : "border-transparent text-muted-foreground hover:bg-muted/45"
                                    )}
                                >
                                    <button
                                        type="button"
                                        role="tab"
                                        aria-selected={active}
                                        onClick={() => dispatch({
                                            type: "activate",
                                            id: tab.id
                                        })}
                                        data-testid={tab.panel
                                            ? `right-sidebar-tab-${tab.panel}`
                                            : "right-sidebar-tab-new"}
                                        className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left outline-none"
                                    >
                                        <Icon className="size-3.5 shrink-0" />
                                        <span className="truncate text-xs font-medium">
                                            {label}
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => closeTab(tab.id)}
                                        aria-label={t("rightSidebar.closeTab", { name: label })}
                                        title={t("rightSidebar.closeTab", { name: label })}
                                        className="ml-1 inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-background/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                                    >
                                        <X className="size-3" />
                                    </button>
                                </div>
                            );
                        })}
                        <button
                            type="button"
                            onClick={addTab}
                            aria-label={t("rightSidebar.newTab")}
                            title={t("rightSidebar.newTab")}
                            data-testid="right-sidebar-add-tab"
                            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                        >
                            <Plus className="size-4" />
                        </button>
                    </div>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("rightSidebar.close")}
                        title={t("rightSidebar.close")}
                        onClick={onToggle}
                        data-testid="right-sidebar-close"
                        className="shrink-0 text-muted-foreground"
                    >
                        <PanelRightClose />
                    </Button>
                </header>

                <div className="flex min-h-0 flex-1 flex-col">
                    {activeTab.panel === null ? (
                        <RightSidebarNewTab onOpenPanel={openPanel} />
                    ) : activeTab.panel === "context" ? (
                        <ContextInspector
                            sessionId={sessionId}
                            providerContextRevision={providerContextRevision}
                        />
                    ) : (
                        <BackgroundTasksPanel sessionId={sessionId} />
                    )}
                </div>
            </aside>
        </>
    );
}
