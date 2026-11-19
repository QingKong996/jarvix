import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { afterEach, expect, test, vi } from "vitest";
import { i18n } from "../../../../../i18n/index.ts";
import type { ToolCallViewData } from "../../../../../core/tools/view.ts";
import { ToolCallBlock } from "./ToolCallBlock.tsx";

afterEach(() => {
    vi.restoreAllMocks();
});

function renderTool(data: Extract<ToolCallViewData, { kind: "generic" }>): string {
    return renderToStaticMarkup(
        <I18nextProvider i18n={i18n}>
            <ToolCallBlock
                toolName="write_file"
                data={data}
                isError={false}
                endReason={data.status === "completed" ? "exited" : null}
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
