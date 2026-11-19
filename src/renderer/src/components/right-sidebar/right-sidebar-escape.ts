const BLOCKING_OVERLAY_SELECTOR = [
    "[data-slot='dialog-content'][data-state='open']",
    "[data-slot='dropdown-menu-content'][data-state='open']",
    "[data-slot='context-menu-content'][data-state='open']",
    "[data-slot='select-content'][data-state='open']"
].join(",");

export function shouldDismissRightSidebar(
    event: Pick<KeyboardEvent, "key" | "defaultPrevented">,
    root: Pick<Document, "querySelector">
): boolean {
    return event.key === "Escape"
        && !event.defaultPrevented
        && root.querySelector(BLOCKING_OVERLAY_SELECTOR) === null;
}
