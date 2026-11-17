import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { expect, test } from "vitest";
import { i18n } from "../../../../../i18n/index.ts";
import { ShellToolCall } from "./ShellToolCall.tsx";

test("renders exec_command as a terminal", () => {
    const html = renderToStaticMarkup(
        <I18nextProvider i18n={i18n}>
            <ShellToolCall
                data={{
                    kind: "shell.exec_command",
                    command: "Get-ChildItem",
                    output: "src\npackage.json\n",
                    status: "completed"
                }}
                streaming={false}
                isError={false}
            />
        </I18nextProvider>
    );

    expect(html).toContain('data-slot="shell-tool"');
    expect(html).toContain("Get-ChildItem");
    expect(html).toContain("package.json");
    expect(html).toContain("$");
});

test("renders write_stdin as a terminal session", () => {
    const html = renderToStaticMarkup(
        <I18nextProvider i18n={i18n}>
            <ShellToolCall
                data={{
                    kind: "shell.write_stdin",
                    sessionId: "12345678-aaaa-bbbb-cccc-ddddeeeeffff",
                    command: "",
                    output: "ready\n",
                    status: "running"
                }}
                streaming
                isError={false}
            />
        </I18nextProvider>
    );

    expect(html).toContain("读取输出");
    expect(html).toContain("ready");
    expect(html).toContain("animate-pulse");
});
