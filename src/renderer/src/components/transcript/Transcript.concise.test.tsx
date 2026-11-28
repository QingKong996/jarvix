// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { i18n } from "../../../../i18n/index.ts";
import type { CommittedTurn } from "./state/types.ts";
import { Transcript } from "./Transcript.tsx";

const { committed } = vi.hoisted(() => ({
    committed: [
        {
            id: "user-1",
            role: "user",
            text: "User prompt",
            blocks: [],
            error: null,
            reason: null
        },
        {
            id: "assistant-1",
            role: "assistant",
            text: "",
            error: null,
            reason: null,
            blocks: [
                {
                    type: "thinking",
                    thinking: "Inspect the workspace"
                },
                {
                    type: "tool",
                    toolCallId: "call-1",
                    toolName: "write_file",
                    data: {
                        kind: "generic",
                        name: "write_file",
                        arguments: { path: "notes.txt" },
                        output: "saved",
                        status: "completed"
                    },
                    isError: false,
                    endReason: null
                }
            ]
        },
        {
            id: "system-1",
            role: "system",
            text: "System note",
            blocks: [],
            error: null,
            reason: null
        },
        {
            id: "assistant-2",
            role: "assistant",
            text: "",
            error: null,
            reason: null,
            blocks: [
                {
                    type: "thinking",
                    thinking: "Finish the task"
                },
                {
                    type: "tool",
                    toolCallId: "call-2",
                    toolName: "write_file",
                    data: {
                        kind: "generic",
                        name: "write_file",
                        arguments: { path: "result.txt" },
                        output: "saved",
                        status: "completed"
                    },
                    isError: false,
                    endReason: null
                },
                {
                    type: "text",
                    text: "Final answer"
                }
            ]
        }
    ] satisfies CommittedTurn[]
}));

vi.mock("./state/transcript-hooks.ts", () => ({
    useCommitted: () => committed,
    useLive: () => null,
    useInjected: () => []
}));

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

test("auto-collapses consecutive process blocks and expands manually", async () => {
    const user = userEvent.setup();
    render(
        <I18nextProvider i18n={i18n}>
            <Transcript sessionId="session-test" concise />
        </I18nextProvider>
    );

    expect(await screen.findAllByText("执行详情")).toHaveLength(1);
    expect(screen.getByText("2 次工具调用")).toBeTruthy();
    expect(screen.getByText("2 次思考")).toBeTruthy();
    expect(screen.queryByText("思考过程")).toBeNull();
    expect(screen.queryByText("系统消息")).toBeNull();
    expect(screen.getByText("User prompt")).toBeTruthy();
    expect(screen.getByText("Final answer")).toBeTruthy();

    await user.click(screen.getByText("执行详情"));

    expect(await screen.findAllByText("思考过程")).toHaveLength(2);
    expect(screen.getByText("系统消息")).toBeTruthy();
});

test("keeps process groups expanded by default in complete mode", async () => {
    render(
        <I18nextProvider i18n={i18n}>
            <Transcript sessionId="session-test" />
        </I18nextProvider>
    );

    expect(await screen.findAllByText("执行详情")).toHaveLength(1);
    expect(await screen.findAllByText("思考过程")).toHaveLength(2);
    expect(screen.getByText("系统消息")).toBeTruthy();
});

test("allows manually collapsing a process group in complete mode", async () => {
    const user = userEvent.setup();
    render(
        <I18nextProvider i18n={i18n}>
            <Transcript sessionId="session-test" />
        </I18nextProvider>
    );

    expect(await screen.findAllByText("思考过程")).toHaveLength(2);
    await user.click(screen.getByText("执行详情"));

    await waitFor(() => {
        expect(screen.queryByText("思考过程")).toBeNull();
    });
});
