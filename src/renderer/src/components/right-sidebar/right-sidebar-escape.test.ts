import { expect, test, vi } from "vitest";
import { shouldDismissRightSidebar } from "./right-sidebar-escape.ts";

function escapeEvent(defaultPrevented = false): Pick<KeyboardEvent, "key" | "defaultPrevented"> {
    return {
        key: "Escape",
        defaultPrevented
    };
}

function rootWithOverlay(overlay: Element | null): Pick<Document, "querySelector"> {
    return {
        querySelector: vi.fn(() => overlay)
    } as unknown as Pick<Document, "querySelector">;
}

test("dismisses the right sidebar when Escape has no overlay to close", () => {
    const root = rootWithOverlay(null);

    expect(shouldDismissRightSidebar(escapeEvent(), root)).toBe(true);
    expect(root.querySelector).toHaveBeenCalledWith(expect.stringContaining(
        "[data-slot='dialog-content'][data-state='open']"
    ));
});

test("leaves the right sidebar open while a dialog or menu handles Escape", () => {
    expect(shouldDismissRightSidebar(
        escapeEvent(),
        rootWithOverlay({} as Element)
    )).toBe(false);
});

test("ignores non-Escape and already handled keyboard events", () => {
    expect(shouldDismissRightSidebar(
        { key: "Enter", defaultPrevented: false },
        rootWithOverlay(null)
    )).toBe(false);
    expect(shouldDismissRightSidebar(
        escapeEvent(true),
        rootWithOverlay(null)
    )).toBe(false);
});
