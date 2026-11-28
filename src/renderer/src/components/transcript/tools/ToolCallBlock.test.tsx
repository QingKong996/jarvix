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
    endReason: ToolCallEndReason | null = null,
    toolName = "write_file"
): string {
    return renderToStaticMarkup(
        <I18nextProvider i18n={i18n}>
            <ToolCallBlock
                toolName={toolName}
                data={data}
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
    ["failed", "failed", null],
    ["completed", "completed", null],
    ["running", "running", null],
    ["terminated", "completed", "terminated"],
    ["background", "completed", "background"],
    ["timed out", "timed_out", null]
] as const)(
    "does not render tool outcome status for %s",
    (_label, status, endReason) => {
        const html = renderTool({
            kind: "generic",
            name: "write_file",
            arguments: {},
            output: "",
            status
        }, endReason);

        expect(html).not.toContain("失败");
        expect(html).not.toContain("已完成");
        expect(html).not.toContain("运行中");
        expect(html).not.toContain("已结束");
        expect(html).not.toContain("后台运行中");
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
    }, null, toolName);

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
