import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { beforeAll, expect, test } from "vitest";
import { i18n } from "../../../../i18n/index.ts";
import { PermissionRequestDialog } from "./PermissionRequestDialog.tsx";

beforeAll(async () => {
    await i18n.changeLanguage("zh");
});

test("renders requested domains and directories at the composer", () => {
    const html = renderToStaticMarkup(
        <I18nextProvider i18n={i18n}>
            <PermissionRequestDialog
                request={{
                    id: "request-1",
                    domains: [{ action: "enable", domain: "api.example.com" }],
                    directories: [{
                        action: "disable",
                        access: "write",
                        path: "C:\\work\\shared"
                    }]
                }}
                onRespond={async () => true}
            />
        </I18nextProvider>
    );

    expect(html).toContain('data-slot="permission-request-dialog"');
    expect(html).toContain("api.example.com");
    expect(html).toContain("C:\\work\\shared");
    expect(html).toContain("启用");
    expect(html).toContain("禁用");
    expect(html).toContain("写入");
    expect(html).toContain("批准");
    expect(html).toContain("取消");
});
