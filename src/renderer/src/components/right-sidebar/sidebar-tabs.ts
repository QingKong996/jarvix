import type { RightSidebarPanel } from "./panel-registry.ts";

export type SidebarTab = {
    id: string;
    panel: RightSidebarPanel | null;
};

export type SidebarTabsState = {
    tabs: SidebarTab[];
    activeTabId: string;
};

export type SidebarTabsAction =
    | { type: "activate"; id: string }
    | { type: "new"; id: string }
    | { type: "open"; panel: RightSidebarPanel; newTabId: string }
    | { type: "close"; id: string; fallbackId: string };

export function createSidebarTabsState(): SidebarTabsState {
    return {
        tabs: [{ id: "context", panel: "context" }],
        activeTabId: "context"
    };
}

export function sidebarTabsReducer(
    state: SidebarTabsState,
    action: SidebarTabsAction
): SidebarTabsState {
    switch (action.type) {
        case "activate":
            return state.tabs.some((tab) => tab.id === action.id)
                ? { ...state, activeTabId: action.id }
                : state;
        case "new":
            return {
                tabs: [...state.tabs, { id: action.id, panel: null }],
                activeTabId: action.id
            };
        case "open": {
            const currentTab = state.tabs.find((tab) => tab.id === state.activeTabId);
            const existingTab = state.tabs.find((tab) => tab.panel === action.panel);
            if (existingTab) {
                return {
                    tabs: state.tabs.filter((tab) => (
                        tab.id !== currentTab?.id || tab.id === existingTab.id
                    )),
                    activeTabId: existingTab.id
                };
            }
            if (currentTab?.panel === null) {
                return {
                    tabs: state.tabs.map((tab) => (
                        tab.id === currentTab.id
                            ? { ...tab, panel: action.panel }
                            : tab
                    )),
                    activeTabId: currentTab.id
                };
            }
            return {
                tabs: [...state.tabs, { id: action.newTabId, panel: action.panel }],
                activeTabId: action.newTabId
            };
        }
        case "close": {
            const index = state.tabs.findIndex((tab) => tab.id === action.id);
            if (index === -1) {
                return state;
            }
            const tabs = state.tabs.filter((tab) => tab.id !== action.id);
            if (tabs.length === 0) {
                return {
                    tabs: [{ id: action.fallbackId, panel: null }],
                    activeTabId: action.fallbackId
                };
            }
            return {
                tabs,
                activeTabId: state.activeTabId === action.id
                    ? state.tabs[index - 1]?.id ?? tabs[0]!.id
                    : state.activeTabId
            };
        }
    }
}

export function activeSidebarTab(state: SidebarTabsState): SidebarTab {
    return state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0]!;
}
