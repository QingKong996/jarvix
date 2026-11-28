// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { i18n } from "../../../../i18n/index.ts";
import type { JarvixConfig } from "../../../../protocol/config.ts";
import type { JarvixBridge } from "../../../../protocol/ipc.ts";
import type { ModelCatalog } from "../../../../protocol/providers.ts";
import type { JarvixSessionSummary } from "../../../../protocol/session.ts";

const setConfig = vi.fn<(config: JarvixConfig) => Promise<JarvixConfig>>();
const getModelCatalog = vi.fn<() => Promise<ModelCatalog>>();
const listSkills = vi.fn<() => Promise<never[]>>();
let SettingsDialog: typeof import("./SettingsDialog.tsx").SettingsDialog;

const archivedSession: JarvixSessionSummary = {
    id: "archived-1",
    name: "Old investigation",
    workingDirectory: "C:\\work\\jarvix",
    createdAt: 1_000,
    updatedAt: 2_000,
    status: "archived",
    archivedAt: 3_000
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
    Object.defineProperty(globalThis, "ResizeObserver", {
        configurable: true,
        value: class {
            observe(): void {}
            unobserve(): void {}
            disconnect(): void {}
        }
    });
    Object.defineProperty(Element.prototype, "hasPointerCapture", {
        configurable: true,
        value: vi.fn(() => false)
    });
    Object.defineProperty(Element.prototype, "setPointerCapture", {
        configurable: true,
        value: vi.fn()
    });
    Object.defineProperty(Element.prototype, "releasePointerCapture", {
        configurable: true,
        value: vi.fn()
    });
    Object.defineProperty(Element.prototype, "scrollIntoView", {
        configurable: true,
        value: vi.fn()
    });
    window.jarvix = {
        setConfig,
        getModelCatalog,
        listSkills
    } as unknown as JarvixBridge;
    ({ SettingsDialog } = await import("./SettingsDialog.tsx"));
});

beforeEach(() => {
    setConfig.mockReset();
    setConfig.mockImplementation(async (config) => config);
    getModelCatalog.mockReset();
    getModelCatalog.mockResolvedValue({
        providers: [],
        fetchedAt: 0,
        stale: false
    });
    listSkills.mockReset();
    listSkills.mockResolvedValue([]);
});

afterEach(() => {
    cleanup();
});

const config: JarvixConfig = {
    language: "zh",
    theme: "light"
};

function renderDialog(
    onOpenChange = vi.fn(),
    onSaved = vi.fn()
): void {
    render(
        <I18nextProvider i18n={i18n}>
            <SettingsDialog
                open
                onOpenChange={onOpenChange}
                config={config}
                onSaved={onSaved}
                archivedSessions={[archivedSession]}
                onUnarchiveSession={vi.fn(async () => true)}
            />
        </I18nextProvider>
    );
}

function submitSettingsForm(): void {
    const form = screen.getByTestId("settings-dialog").querySelector("form");
    if (!form) {
        throw new Error("Settings form was not rendered");
    }
    fireEvent.submit(form);
}

test("switches settings sections and renders archived sessions", async () => {
    const user = userEvent.setup();
    renderDialog();

    await screen.findByTestId("settings-dialog");
    await screen.findByText("尚未添加供应商");

    await user.click(screen.getByTestId("settings-section-general"));
    expect(screen.getByTestId("settings-section-general").getAttribute("aria-current"))
        .toBe("page");

    await user.click(screen.getByTestId("settings-section-archived"));
    expect(screen.getByTestId("settings-section-archived").getAttribute("aria-current"))
        .toBe("page");
    expect(screen.getByText("Old investigation")).toBeTruthy();
});

test("blocks saving an invalid compaction threshold", async () => {
    const user = userEvent.setup();
    renderDialog();

    await screen.findByText("尚未添加供应商");
    await user.click(screen.getByTestId("settings-section-general"));
    const threshold = screen.getByLabelText("上下文压缩阈值");
    await user.type(threshold, "0");
    submitSettingsForm();

    expect((await screen.findByRole("alert")).textContent)
        .toBe("上下文压缩阈值必须是正整数。");
    expect(setConfig).not.toHaveBeenCalled();
});

test("saves general settings and closes the dialog", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();
    renderDialog(onOpenChange, onSaved);

    await screen.findByText("尚未添加供应商");
    await user.click(screen.getByTestId("settings-section-general"));
    await user.type(screen.getByLabelText("上下文压缩阈值"), "4096");
    submitSettingsForm();

    await waitFor(() => {
        expect(setConfig).toHaveBeenCalledWith(expect.objectContaining({
            language: "zh",
            theme: "light",
            contextCompactionThreshold: 4_096,
            providers: [],
            mcpServers: {},
            skills: {}
        }));
        expect(onSaved).toHaveBeenCalledOnce();
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });
});

test("saves concise transcript mode from general settings", async () => {
    const user = userEvent.setup();
    renderDialog();

    await screen.findByText("尚未添加供应商");
    await user.click(screen.getByTestId("settings-section-general"));
    await user.click(screen.getByLabelText("流程展示"));
    await user.click(await screen.findByRole("option", { name: "简洁" }));
    submitSettingsForm();

    await waitFor(() => {
        expect(setConfig).toHaveBeenCalledWith(expect.objectContaining({
            conciseTranscript: true
        }));
    });
});
