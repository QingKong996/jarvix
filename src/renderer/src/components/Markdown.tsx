import { memo } from "react";
import {
    Streamdown,
    defaultComponents,
    type Components,
    type LinkSafetyConfig,
    type PluginConfig,
    type StreamdownTranslations
} from "streamdown";
import { code } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import { cjk } from "@streamdown/cjk";
import { cn } from "cn";

const math = createMathPlugin({ singleDollarTextMath: true });

const plugins: PluginConfig = { code, math, cjk };

const remarkRehypeOptions = { footnoteLabel: "脚注", footnoteBackLabel: "返回正文" };

// External links are opened by the main process through setWindowOpenHandler.
const linkSafety: LinkSafetyConfig = { enabled: false };

const translations: Partial<StreamdownTranslations> = {
    close: "关闭",
    copied: "已复制",
    copyCode: "复制代码",
    copyLink: "复制链接",
    copyTable: "复制表格",
    copyTableAsCsv: "复制为 CSV",
    copyTableAsMarkdown: "复制为 Markdown",
    copyTableAsTsv: "复制为 TSV",
    downloadFile: "下载文件",
    downloadImage: "下载图片",
    downloadTable: "下载表格",
    downloadTableAsCsv: "下载为 CSV",
    downloadTableAsMarkdown: "下载为 Markdown",
    exitFullscreen: "退出全屏",
    imageNotAvailable: "图片不可用",
    openLink: "打开链接",
    resetView: "重置视图",
    tableFormatCsv: "CSV",
    tableFormatMarkdown: "Markdown",
    tableFormatTsv: "TSV",
    viewFullscreen: "全屏查看",
    zoomIn: "放大",
    zoomOut: "缩小"
};

const components: Components = {
    h1: ({ className, ...props }) => (
        <defaultComponents.h1 {...props} className={cn("mt-4 mb-1 text-lg", className)} />
    ),
    h2: ({ className, ...props }) => (
        <defaultComponents.h2 {...props} className={cn("mt-4 mb-1 text-base", className)} />
    ),
    h3: ({ className, ...props }) => (
        <defaultComponents.h3 {...props} className={cn("mt-3 mb-1 text-sm", className)} />
    ),
    h4: ({ className, ...props }) => (
        <defaultComponents.h4 {...props} className={cn("mt-3 mb-1 text-sm", className)} />
    ),
    h5: ({ className, ...props }) => (
        <defaultComponents.h5 {...props} className={cn("mt-3 mb-1 text-sm", className)} />
    ),
    h6: ({ className, ...props }) => (
        <defaultComponents.h6 {...props} className={cn("mt-3 mb-1 text-sm", className)} />
    ),
    inlineCode: ({ node: _node, ...props }) => (
        <code {...props} className={cn("rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]", props.className)} />
    )
};

type MarkdownProps = {
    text: string;
    streaming?: boolean;
    className?: string;
};

// The transcript is the only scroll container, so message content never gets its own vertical scroller.
const UNBOUNDED = Number.POSITIVE_INFINITY;

export const Markdown = memo(function Markdown({ text, streaming = false, className }: MarkdownProps) {
    return (
        <Streamdown
            data-slot="markdown"
            className={cn("text-sm leading-relaxed break-words", className)}
            mode={streaming ? "streaming" : "static"}
            isAnimating={streaming}
            parseIncompleteMarkdown={streaming}
            caret="block"
            codeBlockMaxHeight={UNBOUNDED}
            tableMaxHeight={UNBOUNDED}
            plugins={plugins}
            components={components}
            remarkRehypeOptions={remarkRehypeOptions}
            translations={translations}
            linkSafety={linkSafety}
        >
            {text}
        </Streamdown>
    );
});
