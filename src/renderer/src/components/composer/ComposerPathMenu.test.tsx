import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { ComposerPathMenu } from "./ComposerPathMenu.tsx";

test.each([
    "src/ma",
    "src\\ma",
    "./src/ma",
    ".\\src\\ma"
])("highlights the matched part for query %s", (query) => {
    const html = renderToStaticMarkup(
        <ComposerPathMenu
            paths={[{
                path: "C:\\workspace\\src\\main.ts",
                relativePath: "./src/main.ts",
                name: "main.ts",
                kind: "file"
            }]}
            query={query}
            activeIndex={0}
            label="Files and directories"
            onActiveIndexChange={vi.fn()}
            onSelect={vi.fn()}
        />
    );

    expect(html).toMatch(/<mark[^>]*>ma<\/mark>in\.ts/gu);
    expect(html).toMatch(/\.\/<mark[^>]*>src\/ma<\/mark>in\.ts/gu);
});

test.each([
    "abc",
    "./abc",
    "/abc",
    "\\abc",
    ".\\abc"
])("treats %s as a relative query when it does not match the absolute path", (query) => {
    const html = renderToStaticMarkup(
        <ComposerPathMenu
            paths={[{
                path: "C:\\workspace\\abc",
                relativePath: "./abc",
                name: "abc",
                kind: "directory"
            }]}
            query={query}
            activeIndex={0}
            label="Files and directories"
            onActiveIndexChange={vi.fn()}
            onSelect={vi.fn()}
        />
    );

    expect(html).toMatch(/\.\/<mark[^>]*>abc<\/mark>/u);
});

test("highlights the relative suffix of an absolute path query", () => {
    const html = renderToStaticMarkup(
        <ComposerPathMenu
            paths={[{
                path: "C:\\workspace\\src\\main.ts",
                relativePath: "./src/main.ts",
                name: "main.ts",
                kind: "file"
            }]}
            query="C:\\workspace\\src\\ma"
            activeIndex={0}
            label="Files and directories"
            onActiveIndexChange={vi.fn()}
            onSelect={vi.fn()}
        />
    );

    expect(html).toMatch(/\.\/<mark[^>]*>src\/ma<\/mark>in\.ts/gu);
});

test("highlights a relative query inside an absolute path", () => {
    const html = renderToStaticMarkup(
        <ComposerPathMenu
            paths={[{
                path: "C:\\workspace\\ProgrammingProjects\\Blog",
                relativePath: "C:\\workspace\\ProgrammingProjects\\Blog",
                name: "Blog",
                kind: "directory"
            }]}
            query="ProgrammingProjects/Blog"
            activeIndex={0}
            label="Files and directories"
            onActiveIndexChange={vi.fn()}
            onSelect={vi.fn()}
        />
    );

    expect(html).toMatch(/<mark[^>]*>Blog<\/mark>/gu);
    expect(html).toMatch(/C:\\workspace\\<mark[^>]*>ProgrammingProjects\\Blog<\/mark>/gu);
});

test("requires an absolute query to prefix the absolute path", () => {
    const html = renderToStaticMarkup(
        <ComposerPathMenu
            paths={[{
                path: "C:\\workspace\\ProgrammingProjects\\Blog",
                relativePath: "C:\\workspace\\ProgrammingProjects\\Blog",
                name: "Blog",
                kind: "directory"
            }]}
            query="D:\\ProgrammingProjects\\Other"
            activeIndex={0}
            label="Files and directories"
            onActiveIndexChange={vi.fn()}
            onSelect={vi.fn()}
        />
    );

    expect(html).not.toContain("<mark");
});
