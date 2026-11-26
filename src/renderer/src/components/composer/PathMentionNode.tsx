import { X } from "lucide-react";
import { Node, mergeAttributes } from "@tiptap/core";
import type { MouseEvent } from "react";
import {
    NodeViewWrapper,
    ReactNodeViewRenderer,
    type ReactNodeViewProps
} from "@tiptap/react";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { cn } from "cn";
import type { JarvixPathKind } from "../../../../protocol/path-completion.ts";
import { pathIcon } from "./path-icons.ts";
import {
    PATH_MENTION_NODE_NAME,
    serializedPathMention
} from "./composer-path-mentions.ts";

export type PathMentionAttributes = {
    token: string;
    path: string;
    name: string;
    kind: JarvixPathKind;
};

export const PathMention = Node.create({
    name: PATH_MENTION_NODE_NAME,
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,

    addAttributes() {
        return {
            token: { default: "" },
            path: { default: "" },
            name: { default: "" },
            kind: { default: "file" }
        };
    },

    parseHTML() {
        return [{
            tag: "span[data-path-mention]",
            getAttrs: (element) => {
                const node = element as HTMLElement;
                return {
                    token: node.dataset.token ?? "",
                    path: node.dataset.path ?? "",
                    name: node.dataset.name ?? node.textContent ?? "",
                    kind: node.dataset.kind === "directory" ? "directory" : "file"
                };
            }
        }];
    },

    renderHTML({ node, HTMLAttributes }) {
        return [
            "span",
            mergeAttributes(HTMLAttributes, {
                "data-path-mention": "",
                "data-token": node.attrs.token,
                "data-path": node.attrs.path,
                "data-name": node.attrs.name,
                "data-kind": node.attrs.kind
            }),
            node.attrs.name
        ];
    },

    renderText({ node }) {
        return serializedPathMention(node.attrs.token as string);
    },

    addNodeView() {
        return ReactNodeViewRenderer(PathMentionView);
    }
});

function PathMentionView({
    node,
    editor,
    getPos,
    deleteNode,
    selected
}: ReactNodeViewProps) {
    const attributes = node.attrs as PathMentionAttributes;
    const Icon = pathIcon(attributes.kind, attributes.name || attributes.path);

    function restorePath(): void {
        const position = getPos();
        if (typeof position !== "number" || !attributes.token) {
            return;
        }
        editor
            .chain()
            .focus()
            .insertContentAt(
                {
                    from: position,
                    to: position + node.nodeSize
                },
                {
                    type: "text",
                    text: attributes.token
                }
            )
            .setTextSelection(position + attributes.token.length)
            .run();
    }

    return (
        <TooltipPrimitive.Provider delayDuration={150}>
            <TooltipPrimitive.Root>
                <TooltipPrimitive.Trigger asChild>
                    <NodeViewWrapper
                        as="span"
                        contentEditable={false}
                        data-path-mention-node=""
                        className="inline-flex max-w-full items-center align-middle"
                    >
                        <span
                            aria-hidden="true"
                            className="h-5 w-[0.3em] shrink-0 select-none"
                        />
                        <span
                            onClick={(event: MouseEvent<HTMLSpanElement>) => {
                                event.preventDefault();
                                event.stopPropagation();
                                restorePath();
                            }}
                            className={cn(
                                "group/path-mention relative inline-flex min-w-0 max-w-[min(20rem,70vw)] cursor-pointer items-center gap-1",
                                "rounded-md border border-border/80 bg-background px-2 py-0.5 text-[12.5px] leading-5",
                                "text-foreground transition-colors hover:border-border-strong",
                                selected && "ring-2 ring-ring/35"
                            )}
                        >
                            <span
                                role="button"
                                tabIndex={-1}
                                aria-label={`Remove ${attributes.name}`}
                                className="-ml-0.5 flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm hover:bg-destructive/10 hover:text-destructive"
                                onMouseDown={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                }}
                                onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    deleteNode();
                                }}
                            >
                                <Icon className="size-3.5 group-hover/path-mention:hidden" />
                                <X className="hidden size-3.5 group-hover/path-mention:block" />
                            </span>
                            <span className="min-w-0 truncate">{attributes.name}</span>
                        </span>
                        <span
                            aria-hidden="true"
                            className="h-5 w-[0.3em] shrink-0 select-none"
                        />
                    </NodeViewWrapper>
                </TooltipPrimitive.Trigger>
                <TooltipPrimitive.Portal>
                    <TooltipPrimitive.Content
                        side="top"
                        align="start"
                        sideOffset={6}
                        collisionPadding={8}
                        className={cn(
                            "z-50 max-w-[min(32rem,80vw)] rounded-lg border border-border-strong bg-popover px-2.5 py-1",
                            "text-xs leading-5 break-all text-popover-foreground shadow-[0_6px_16px_rgb(0_0_0/0.07)] dark:shadow-[0_8px_20px_rgb(0_0_0/0.38)]"
                        )}
                    >
                        {attributes.path}
                    </TooltipPrimitive.Content>
                </TooltipPrimitive.Portal>
            </TooltipPrimitive.Root>
        </TooltipPrimitive.Provider>
    );
}
