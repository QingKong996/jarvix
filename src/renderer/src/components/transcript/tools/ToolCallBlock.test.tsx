import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { afterEach, expect, test, vi } from "vitest";
import { i18n } from "../../../../../i18n/index.ts";
import type { ToolCallEndReason } from "../../../../../runtime/tools/types.ts";
import type { ToolCallViewData } from "../../../../../runtime/tools/view.ts";
import { ToolCallBlock } from "./ToolCallBlock.tsx";

afterEach(() => {
    vi.restoreAllMocks();
});

function renderTool(
    data: ToolCallViewData,
    isError = false,
    endReason: ToolCallEndReason | null = null,
    toolName = "write_file"
): string {
    return renderToStaticMarkup(
        <I18nextProvider i18n={i18n}>
            <ToolCallBlock
                toolName={toolName}
                data={data}
                isError={isError}
                endReason={endReason}
            />
        </I18nextProvider>
    );
}

test("does not serialize collapsed generic tool arguments", () => {
    const value = vi.fn(() => "x".repeat(256 * 1024));
    const arguments_: Record<string, unknown> = {};
    Object.defineProperty(arguments_, "content", {
        enumerable: true,
        get: value
    });

    const html = renderTool({
        kind: "generic",
        name: "write_file",
        arguments: arguments_,
        output: "",
        status: "completed"
    });

    expect(value).not.toHaveBeenCalled();
    expect(html).not.toContain("x".repeat(1024));
});

test("renders active generic tool arguments while the call is expanded", () => {
    const html = renderTool({
        kind: "generic",
        name: "write_file",
        arguments: { path: "notes.txt", content: "hello" },
        output: "",
        status: "running"
    });

    expect(html).toContain("notes.txt");
    expect(html).toContain("hello");
});

test.each([
    ["failed status", false, "failed", null, "失败"],
    ["error flag", true, "running", "terminated", "失败"],
    ["termination", false, "completed", "terminated", "已结束"],
    ["background completion", false, "completed", "background", "后台运行中"],
    ["timed out", false, "timed_out", null, "后台运行中"]
] as const)(
    "shows the highest-priority status for %s",
    (_label, isError, status, endReason, expected) => {
        const html = renderTool({
            kind: "generic",
            name: "write_file",
            arguments: {},
            output: "",
            status
        }, isError, endReason);

        expect(html).toContain(expected);
    }
);

test.each([
    ["update_goal", "更新目标"],
    ["finish_goal", "结束目标"]
] as const)("labels the %s goal tool", (toolName, label) => {
    const html = renderTool({
        kind: "generic",
        name: toolName,
        arguments: {},
        output: "",
        status: "completed"
    }, false, null, toolName);

    expect(html).toContain(label);
});

test("keeps completed image results expanded", () => {
    const html = renderTool({
        kind: "image.view_image",
        path: "shot.png",
        mimeType: "image/png",
        imageUrl: "data:image/png;base64,AAAA",
        output: "",
        status: "completed"
    });

    expect(html).toContain("shot.png");
    expect(html).toContain("data:image/png;base64,AAAA");
});
