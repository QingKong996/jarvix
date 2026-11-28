// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { i18n } from "../../../../i18n/index.ts";
import { ProcessGroup, type ProcessGroupEntry } from "./ProcessGroup.tsx";

const runningEntries = [
    {
        kind: "thinking",
        key: "thinking-1",
        text: "Inspect the workspace",
        streaming: true
    },
    {
        kind: "tool",
        key: "tool-1",
        toolName: "write_file",
        data: {
            kind: "generic",
            name: "write_file",
            arguments: { path: "notes.txt" },
            output: "saved output",
            status: "running"
        },
        isError: false,
        endReason: null
    }
] satisfies ProcessGroupEntry[];

const completedEntries = [
    {
        kind: "thinking",
        key: "thinking-1",
        text: "Inspect the workspace",
        streaming: false
    },
    {
        kind: "tool",
        key: "tool-1",
        toolName: "write_file",
        data: {
            kind: "generic",
            name: "write_file",
            arguments: { path: "notes.txt" },
            output: "saved output",
            status: "completed"
        },
        isError: false,
        endReason: null
    }
] satisfies ProcessGroupEntry[];

beforeAll(async () => {
    await i18n.changeLanguage("zh");
    Object.defineProperty(window, "scrollTo", {
        configurable: true,
        value: vi.fn()
    });
});

afterEach(() => {
    cleanup();
});

test("collapses inner calls and thinking when they complete", async () => {
    const { rerender } = render(
        <I18nextProvider i18n={i18n}>
            <ProcessGroup entries={runningEntries} defaultOpen />
        </I18nextProvider>
    );

    expect(await screen.findByText("Inspect the workspace")).toBeTruthy();
    expect(screen.getByText("saved output")).toBeTruthy();

    rerender(
        <I18nextProvider i18n={i18n}>
            <ProcessGroup entries={completedEntries} defaultOpen />
        </I18nextProvider>
    );

    await waitFor(() => {
        expect(screen.queryByText("Inspect the workspace")).toBeNull();
        expect(screen.queryByText("saved output")).toBeNull();
    });
});
