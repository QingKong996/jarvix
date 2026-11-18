import { ScanEye, Terminal } from "lucide-react";

export type RightSidebarPanel = "context" | "background";

type RightSidebarLabelKey =
    | "rightSidebar.tabs.context"
    | "rightSidebar.tabs.background";

type RightSidebarPanelDefinition = {
    panel: RightSidebarPanel;
    labelKey: RightSidebarLabelKey;
    icon: typeof ScanEye;
};

const PANEL_DEFINITIONS = {
    context: {
        labelKey: "rightSidebar.tabs.context",
        icon: ScanEye
    },
    background: {
        labelKey: "rightSidebar.tabs.background",
        icon: Terminal
    }
} as const satisfies Record<RightSidebarPanel, Omit<RightSidebarPanelDefinition, "panel">>;

export const RIGHT_SIDEBAR_PANELS = (
    Object.keys(PANEL_DEFINITIONS) as RightSidebarPanel[]
).map((panel) => rightSidebarPanel(panel));

export function rightSidebarPanel(panel: RightSidebarPanel): RightSidebarPanelDefinition {
    return { panel, ...PANEL_DEFINITIONS[panel] };
}
