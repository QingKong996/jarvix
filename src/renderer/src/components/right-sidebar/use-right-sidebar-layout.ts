import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const DESKTOP_RIGHT_SIDEBAR_QUERY = "(min-width: 1280px)";

export const RIGHT_SIDEBAR_PANEL_ID = "right-sidebar";

export function useRightSidebarLayout() {
    const [open, setOpen] = useState(false);
    const [desktop, setDesktop] = useState(
        () => window.matchMedia(DESKTOP_RIGHT_SIDEBAR_QUERY).matches
    );
    const triggerRef = useRef<HTMLButtonElement>(null);
    const wasOpen = useRef(false);

    useEffect(() => {
        const mediaQuery = window.matchMedia(DESKTOP_RIGHT_SIDEBAR_QUERY);
        const update = (): void => setDesktop(mediaQuery.matches);
        update();
        mediaQuery.addEventListener("change", update);
        return () => mediaQuery.removeEventListener("change", update);
    }, []);

    useEffect(() => {
        if (wasOpen.current && !open) {
            triggerRef.current?.focus();
        }
        wasOpen.current = open;
    }, [open]);

    const openSidebar = useCallback(() => {
        setOpen(true);
    }, []);

    const closeSidebar = useCallback(() => {
        setOpen(false);
    }, []);

    const inPanel = desktop && open;
    const panelIds = useMemo(
        () => inPanel
            ? ["sidebar", "content", RIGHT_SIDEBAR_PANEL_ID]
            : ["sidebar", "content"],
        [inPanel]
    );

    return { open, inPanel, panelIds, openSidebar, closeSidebar, triggerRef };
}
