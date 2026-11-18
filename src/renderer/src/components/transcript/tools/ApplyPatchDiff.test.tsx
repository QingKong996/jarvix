import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { expect, test } from "vitest";
import { i18n } from "../../../../../i18n/index.ts";
import {
    ApplyPatchDiff,
    PATCH_PREVIEW_LINE_LIMIT
} from "./ApplyPatchDiff.tsx";

function renderPatch(patch: string): string {
    return renderToStaticMarkup(
        <I18nextProvider i18n={i18n}>
            <ApplyPatchDiff patch={patch} />
        </I18nextProvider>
    );
}

test("renders the original patch text with change backgrounds", () => {
    const patch = [
        "*** Begin Patch",
        "*** Update File: src/config.ts",
        "@@",
        "-const enabled = false;",
        "+const enabled = true;",
        " unchanged",
        "*** End Patch"
    ].join("\n");

    const html = renderPatch(patch);

    expect(html).toContain('data-kind="add"');
    expect(html).toContain('data-kind="remove"');
    expect(html).toContain("bg-red-500/15");
    expect(html).toContain("bg-emerald-500/15");
    expect(html).toContain("const enabled = false;");
    expect(html).toContain("const enabled = true;");
    expect(html.indexOf("*** Begin Patch"))
        .toBeLessThan(html.indexOf("-const enabled = false;"));
    expect(html.indexOf("-const enabled = false;"))
        .toBeLessThan(html.indexOf("+const enabled = true;"));
    expect(html.indexOf("+const enabled = true;"))
        .toBeLessThan(html.indexOf("*** End Patch"));
    expect(html).not.toContain("tabular-nums");
    expect(html).not.toContain("grid-cols-[3.25rem");
});

test("bounds a large patch preview", () => {
    const patch = [
        "*** Begin Patch",
        ...Array.from({ length: 500 }, (_, index) => `+line-${index}`),
        "*** End Patch"
    ].join("\n");

    const html = renderPatch(patch);

    expect((html.match(/data-kind=/g) ?? []).length).toBe(PATCH_PREVIEW_LINE_LIMIT);
    expect(html).toContain('data-slot="apply-patch-preview-notice"');
    expect(html).not.toContain("+line-499");
});

test("truncates an oversized patch line", () => {
    const line = `+${"x".repeat(100_000)}`;
    const html = renderPatch(line);

    expect(html).not.toContain(line);
    expect(html).toContain("…");
    expect(html).toContain('data-slot="apply-patch-preview-notice"');
});
