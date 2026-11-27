// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { i18n } from "../../../../i18n/index.ts";
import type { JarvixBridge } from "../../../../protocol/ipc.ts";
import type { JarvixProject } from "../../../../protocol/project.ts";

const pickWorkingDirectories = vi.fn<() => Promise<string[]>>();
let CreateProjectDialog: typeof import("./CreateProjectDialog.tsx").CreateProjectDialog;

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
    window.jarvix = { pickWorkingDirectories } as unknown as JarvixBridge;
    ({ CreateProjectDialog } = await import("./CreateProjectDialog.tsx"));
});

beforeEach(() => {
    pickWorkingDirectories.mockReset();
});

afterEach(() => {
    cleanup();
});

function renderDialog(
    onCreate: (name: string, workingDirectories: string[]) => Promise<JarvixProject | null>
): void {
    render(
        <I18nextProvider i18n={i18n}>
            <CreateProjectDialog
                open
                onOpenChange={vi.fn()}
                onCreate={onCreate}
            />
        </I18nextProvider>
    );
}

test("requires a name and at least one working directory", async () => {
    const user = userEvent.setup();
    pickWorkingDirectories.mockResolvedValue(["C:\\work\\jarvix"]);
    renderDialog(vi.fn(async () => null));

    const createButton = screen.getByTestId("project-create") as HTMLButtonElement;
    expect(createButton.disabled).toBe(true);

    await user.type(screen.getByTestId("project-name"), "Jarvix");
    expect(createButton.disabled).toBe(true);

    await user.click(screen.getByTestId("project-add-directories"));
    await screen.findByText("C:\\work\\jarvix");
    expect(createButton.disabled).toBe(false);
});

test("trims the project name and submits selected directories", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onCreate = vi.fn(async () => ({
        type: "project" as const,
        version: 1,
        id: "project-1",
        name: "Jarvix",
        workingDirectories: ["C:\\work\\jarvix"],
        createdAt: 1_000
    }));
    pickWorkingDirectories.mockResolvedValue(["C:\\work\\jarvix"]);

    render(
        <I18nextProvider i18n={i18n}>
            <CreateProjectDialog
                open
                onOpenChange={onOpenChange}
                onCreate={onCreate}
            />
        </I18nextProvider>
    );

    await user.type(screen.getByTestId("project-name"), "  Jarvix  ");
    await user.click(screen.getByTestId("project-add-directories"));
    await user.click(await screen.findByTestId("project-create"));

    await waitFor(() => {
        expect(onCreate).toHaveBeenCalledWith("Jarvix", ["C:\\work\\jarvix"]);
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });
});

test("reports a failed project creation without closing", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    pickWorkingDirectories.mockResolvedValue(["C:\\work\\jarvix"]);
    render(
        <I18nextProvider i18n={i18n}>
            <CreateProjectDialog
                open
                onOpenChange={onOpenChange}
                onCreate={vi.fn(async () => null)}
            />
        </I18nextProvider>
    );

    await user.type(screen.getByTestId("project-name"), "Jarvix");
    await user.click(screen.getByTestId("project-add-directories"));
    await user.click(await screen.findByTestId("project-create"));

    expect((await screen.findByRole("alert")).textContent).toBe("无法创建项目。");
    expect(onOpenChange).not.toHaveBeenCalled();
});
