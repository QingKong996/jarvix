// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { i18n } from "../../../../i18n/index.ts";
import type { JarvixSessionSummary } from "../../../../protocol/session.ts";
import { DeleteSessionDialog } from "./DeleteSessionDialog.tsx";
import { RenameSessionDialog } from "./RenameSessionDialog.tsx";

const session: JarvixSessionSummary = {
    id: "session-1",
    name: "Original name",
    workingDirectory: "C:\\work\\jarvix",
    createdAt: 1_000,
    updatedAt: 2_000,
    status: "active"
};

beforeAll(async () => {
    await i18n.changeLanguage("zh");
    Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: vi.fn().mockImplementation((query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn()
        }))
    });
    Object.defineProperty(window, "scrollTo", {
        configurable: true,
        value: vi.fn()
    });
});

afterEach(() => {
    cleanup();
});

test("renames a session with the trimmed input and closes", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn(async () => true);
    const onOpenChange = vi.fn();
    render(
        <I18nextProvider i18n={i18n}>
            <RenameSessionDialog
                session={session}
                onOpenChange={onOpenChange}
                onRename={onRename}
            />
        </I18nextProvider>
    );

    const input = screen.getByTestId("rename-session-name") as HTMLInputElement;
    expect(input.value).toBe("Original name");
    await user.clear(input);
    await user.type(input, "  Renamed session  ");
    await user.click(screen.getByTestId("rename-session-submit"));

    await waitFor(() => {
        expect(onRename).toHaveBeenCalledWith("session-1", "Renamed session");
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });
});

test("keeps the rename dialog open and reports a failed rename", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
        <I18nextProvider i18n={i18n}>
            <RenameSessionDialog
                session={session}
                onOpenChange={onOpenChange}
                onRename={vi.fn(async () => false)}
            />
        </I18nextProvider>
    );

    await user.click(screen.getByTestId("rename-session-submit"));

    expect((await screen.findByRole("alert")).textContent).toBe("无法重命名会话。");
    expect(onOpenChange).not.toHaveBeenCalled();
});

test("deletes the selected session and closes on success", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn(async () => true);
    const onOpenChange = vi.fn();
    render(
        <I18nextProvider i18n={i18n}>
            <DeleteSessionDialog
                session={session}
                onOpenChange={onOpenChange}
                onDelete={onDelete}
            />
        </I18nextProvider>
    );

    expect(screen.getByText(/Original name/)).toBeTruthy();
    await user.click(screen.getByTestId("delete-session-confirm"));

    await waitFor(() => {
        expect(onDelete).toHaveBeenCalledWith("session-1");
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });
});

test("reports a failed session deletion", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
        <I18nextProvider i18n={i18n}>
            <DeleteSessionDialog
                session={session}
                onOpenChange={onOpenChange}
                onDelete={vi.fn(async () => false)}
            />
        </I18nextProvider>
    );

    await user.click(screen.getByTestId("delete-session-confirm"));

    expect((await screen.findByRole("alert")).textContent).toBe("无法删除该会话。");
    expect(onOpenChange).not.toHaveBeenCalled();
});
