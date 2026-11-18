import { expect, test } from "vitest";
import {
    activeSidebarTab,
    createSidebarTabsState,
    sidebarTabsReducer
} from "./sidebar-tabs.ts";

test("opens panels without duplicating existing tabs", () => {
    const newTab = sidebarTabsReducer(createSidebarTabsState(), {
        type: "new",
        id: "new-1"
    });
    expect(activeSidebarTab(newTab).panel).toBeNull();

    const background = sidebarTabsReducer(newTab, {
        type: "open",
        panel: "background",
        newTabId: "background-1"
    });
    expect(background.tabs.map((tab) => tab.panel)).toEqual(["context", "background"]);
    expect(background.activeTabId).toBe("new-1");

    const launcher = sidebarTabsReducer(background, { type: "new", id: "new-2" });
    const existingContext = sidebarTabsReducer(launcher, {
        type: "open",
        panel: "context",
        newTabId: "context-2"
    });
    expect(existingContext.tabs.map((tab) => tab.id)).toEqual(["context", "new-1"]);
    expect(existingContext.activeTabId).toBe("context");
});

test("closing the last tab leaves a new tab page", () => {
    const state = sidebarTabsReducer(createSidebarTabsState(), {
        type: "close",
        id: "context",
        fallbackId: "new-1"
    });

    expect(state.tabs).toEqual([{ id: "new-1", panel: null }]);
    expect(state.activeTabId).toBe("new-1");
});
