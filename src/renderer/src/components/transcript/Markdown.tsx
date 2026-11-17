import { memo } from "react";
import { useTranslation } from "react-i18next";
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

// External links are opened by the main process through setWindowOpenHandler.
const linkSafety: LinkSafetyConfig = { enabled: false };

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
    const { t } = useTranslation();

    const remarkRehypeOptions = {
        footnoteLabel: t("markdown.footnoteLabel"),
        footnoteBackLabel: t("markdown.footnoteBackLabel")
    };

    const translations: Partial<StreamdownTranslations> = {
        close: t("markdown.close"),
        copied: t("markdown.copied"),
        copyCode: t("markdown.copyCode"),
        copyLink: t("markdown.copyLink"),
        copyTable: t("markdown.copyTable"),
        copyTableAsCsv: t("markdown.copyTableAsCsv"),
        copyTableAsMarkdown: t("markdown.copyTableAsMarkdown"),
        copyTableAsTsv: t("markdown.copyTableAsTsv"),
        downloadFile: t("markdown.downloadFile"),
        downloadImage: t("markdown.downloadImage"),
        downloadTable: t("markdown.downloadTable"),
        downloadTableAsCsv: t("markdown.downloadTableAsCsv"),
        downloadTableAsMarkdown: t("markdown.downloadTableAsMarkdown"),
        exitFullscreen: t("markdown.exitFullscreen"),
        imageNotAvailable: t("markdown.imageNotAvailable"),
        openLink: t("markdown.openLink"),
        resetView: t("markdown.resetView"),
        tableFormatCsv: t("markdown.tableFormatCsv"),
        tableFormatMarkdown: t("markdown.tableFormatMarkdown"),
        tableFormatTsv: t("markdown.tableFormatTsv"),
        viewFullscreen: t("markdown.viewFullscreen"),
        zoomIn: t("markdown.zoomIn"),
        zoomOut: t("markdown.zoomOut")
    };

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
