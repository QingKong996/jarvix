import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { ApplyPatchDiff } from "./ApplyPatchDiff.tsx";

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

    const html = renderToStaticMarkup(<ApplyPatchDiff patch={patch} />);

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
