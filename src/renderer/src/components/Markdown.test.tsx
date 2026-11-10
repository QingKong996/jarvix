import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, test } from "vitest";
import { i18n } from "@/i18n/index.ts";
import { Markdown } from "./Markdown.tsx";

function render(markdown: string, streaming = false): string {
    return renderToStaticMarkup(<Markdown text={markdown} streaming={streaming} />);
}

beforeAll(async () => {
    await i18n.changeLanguage("zh");
});

describe("Markdown", () => {
    test("renders CJK emphasis that plain CommonMark would reject", () => {
        const html = render("中文**强调**：这些星号不会被识别**都是因为**这个句子。");

        expect(html).toContain('data-streamdown="strong">强调</span>');
        expect(html).toContain('data-streamdown="strong">都是因为</span>');
        expect(html).not.toContain("**");
    });

    test("renders inline math delimited by single dollars", () => {
        const html = render("勾股定理 $a^2 + b^2 = c^2$。");

        expect(html).toContain('class="katex"');
    });

    test("completes unterminated markdown while streaming", () => {
        const html = render("正在输出**流式粗体，尚未闭合", true);

        expect(html).toContain('data-streamdown="strong"');
        expect(html).not.toContain("**");
    });

    test("keeps unterminated markdown literal for committed content", () => {
        const html = render("输出**未闭合");

        expect(html).not.toContain('data-streamdown="strong"');
        expect(html).toContain("**");
    });

    test("renders tables and fenced code blocks", () => {
        const html = render("| A | B |\n| :-- | --: |\n| 1 | 2 |\n\n```ts\nconst n = 1;\n```");

        expect(html).toContain("<table");
        expect(html).toContain('data-language="ts"');
    });

    test("localizes footnote labels", () => {
        const html = render("脚注[^1]\n\n[^1]: 内容。");

        expect(html).toContain("脚注");
        expect(html).toContain("返回正文");
    });
});
