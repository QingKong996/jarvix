import { useEffect } from "react";
import { Globe, PanelRightClose, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "cn";
import { ContextInspector } from "../context-inspector/ContextInspector.tsx";
import { BackgroundTasksPanel } from "./BackgroundTasksPanel.tsx";
import { rightSidebarPanel } from "./panel-registry.ts";
import { RightSidebarNewTab } from "./RightSidebarNewTab.tsx";
import { shouldDismissRightSidebar } from "./right-sidebar-escape.ts";
import { activeSidebarTab } from "./sidebar-tabs.ts";
import type { RightSidebarTabs } from "./use-right-sidebar-tabs.ts";
import { Button } from "@/components/ui/button";

type RightSidebarProps = {
    variant: "panel" | "overlay";
    tabs: RightSidebarTabs;
    sessionId: string | null;
    providerContextRevision: number;
    onClose(): void;
};

export function RightSidebar({
    variant,
    tabs,
    sessionId,
    providerContextRevision,
    onClose
}: RightSidebarProps) {
    const { t } = useTranslation();

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent): void => {
            if (shouldDismissRightSidebar(event, document)) {
                onClose();
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [onClose]);

    const activeTab = activeSidebarTab(tabs.state);

    return (
        <>
            {variant === "overlay" ? (
                <div
                    aria-hidden="true"
                    data-testid="right-sidebar-overlay"
                    onClick={onClose}
                    className="fixed inset-0 z-20 bg-background/70"
                />
            ) : null}
            <aside
                aria-labelledby="right-sidebar-title"
                data-testid="right-sidebar"
                className={cn(
                    "flex h-full min-h-0 w-full flex-col bg-popover",
                    variant === "overlay"
                        ? "fixed inset-y-0 right-0 z-30 w-[min(30rem,calc(100vw-2rem))] border-l border-border shadow-xl"
                        : "shrink-0"
                )}
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
                        {tabs.state.tabs.map((tab) => {
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
                                        onClick={() => tabs.activateTab(tab.id)}
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
                                        onClick={() => tabs.closeTab(tab.id)}
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
                            onClick={tabs.addTab}
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
                        onClick={onClose}
                        data-testid="right-sidebar-close"
                        className="shrink-0 text-muted-foreground"
                    >
                        <PanelRightClose />
                    </Button>
                </header>

                <div className="flex min-h-0 flex-1 flex-col">
                    {activeTab.panel === null ? (
                        <RightSidebarNewTab onOpenPanel={tabs.openPanel} />
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
