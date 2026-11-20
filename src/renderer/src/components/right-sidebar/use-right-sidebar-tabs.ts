import { useMemo, useReducer, useRef } from "react";
import type { RightSidebarPanel } from "./panel-registry.ts";
import {
    createSidebarTabsState,
    sidebarTabsReducer,
    type SidebarTabsState
} from "./sidebar-tabs.ts";

export type RightSidebarTabs = {
    state: SidebarTabsState;
    addTab(): void;
    activateTab(id: string): void;
    closeTab(id: string): void;
    openPanel(panel: RightSidebarPanel): void;
};

export function useRightSidebarTabs(): RightSidebarTabs {
    const [state, dispatch] = useReducer(
        sidebarTabsReducer,
        undefined,
        createSidebarTabsState
    );
    const tabIdRef = useRef(0);

    return useMemo(() => {
        const nextTabId = (): string => `right-sidebar-tab-${++tabIdRef.current}`;
        return {
            state,
            addTab() {
                dispatch({ type: "new", id: nextTabId() });
            },
            activateTab(id) {
                dispatch({ type: "activate", id });
            },
            closeTab(id) {
                dispatch({ type: "close", id, fallbackId: nextTabId() });
            },
            openPanel(panel) {
                dispatch({ type: "open", panel, newTabId: nextTabId() });
            }
        };
    }, [state]);
}
