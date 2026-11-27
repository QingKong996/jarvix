// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { i18n } from "../../../../i18n/index.ts";
import type { JarvixProject } from "../../../../protocol/project.ts";
import type { JarvixSessionSummary } from "../../../../protocol/session.ts";
import { Sidebar } from "./Sidebar.tsx";

const project: JarvixProject = {
    type: "project",
    version: 1,
    id: "project-1",
    name: "Jarvix",
    workingDirectories: ["C:\\work\\jarvix"],
    createdAt: 1_000
};

const projectSession: JarvixSessionSummary = {
    id: "session-1",
    name: "Fix CI",
    projectId: project.id,
    createdAt: 2_000,
    updatedAt: 3_000,
    status: "active"
};

const temporarySession: JarvixSessionSummary = {
    id: "session-2",
    name: "Quick question",
    workingDirectory: "C:\\work\\scratch",
    createdAt: 4_000,
    updatedAt: 5_000,
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

function renderSidebar(
    overrides: Partial<Parameters<typeof Sidebar>[0]> = {}
): ReturnType<typeof render> {
    return render(
        <I18nextProvider i18n={i18n}>
            <Sidebar
                projects={[project]}
                sessions={[projectSession, temporarySession]}
                activeSessionId={projectSession.id}
                busy={false}
                onSelectSession={vi.fn()}
                onNewProject={vi.fn()}
                onNewSession={vi.fn()}
                onMoveSession={vi.fn()}
                onRenameSession={vi.fn(async () => true)}
                onAutoNameSession={vi.fn(async () => true)}
                onArchiveSession={vi.fn(async () => true)}
                onDeleteSession={vi.fn(async () => true)}
                onOpenProjectDetails={vi.fn()}
                onOpenSettings={vi.fn()}
                {...overrides}
            />
        </I18nextProvider>
    );
}

test("renders project and temporary sessions with the active session marked", () => {
    renderSidebar();

    expect(screen.getByRole("button", { name: "Jarvix" })).toBeTruthy();
    expect(screen.getByText("临时会话")).toBeTruthy();
    const activeSession = screen.getByRole("button", { name: "Fix CI" });
    expect(activeSession.getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "Quick question" }).getAttribute("aria-current"))
        .toBeNull();
});

test("routes sidebar actions and session selection", async () => {
    const user = userEvent.setup();
    const onSelectSession = vi.fn();
    const onNewProject = vi.fn();
    const onNewSession = vi.fn();
    const onOpenSettings = vi.fn();
    const onOpenProjectDetails = vi.fn();
    renderSidebar({
        onSelectSession,
        onNewProject,
        onNewSession,
        onOpenSettings,
        onOpenProjectDetails
    });

    await user.click(screen.getByRole("button", { name: "Quick question" }));
    await user.click(screen.getByTestId("new-session"));
    await user.click(screen.getByTestId("new-project"));
    await user.click(screen.getByRole("button", { name: "在 Jarvix 中新建会话" }));
    await user.click(screen.getByRole("button", { name: "项目详情" }));
    await user.click(screen.getByTestId("open-settings"));

    expect(onSelectSession).toHaveBeenCalledWith("session-2");
    expect(onNewSession).toHaveBeenNthCalledWith(1);
    expect(onNewSession).toHaveBeenNthCalledWith(2, "project-1");
    expect(onNewProject).toHaveBeenCalledOnce();
    expect(onOpenProjectDetails).toHaveBeenCalledWith(project);
    expect(onOpenSettings).toHaveBeenCalledOnce();
});

test("shows an empty state and disables session actions while busy", () => {
    renderSidebar({
        projects: [],
        sessions: [],
        activeSessionId: null,
        busy: true
    });

    expect(screen.getByText("暂无项目")).toBeTruthy();
    expect((screen.getByTestId("new-session") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("new-project") as HTMLButtonElement).disabled).toBe(true);
});
