import { Sparkles, X } from "lucide-react";
import { Node, mergeAttributes } from "@tiptap/core";
import type { MouseEvent } from "react";
import {
    NodeViewWrapper,
    ReactNodeViewRenderer,
    type ReactNodeViewProps
} from "@tiptap/react";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { cn } from "cn";
import {
    SKILL_MENTION_NODE_NAME,
    serializedSkillMention,
    type SelectedSkillMention
} from "./composer-skill-mentions.ts";

export const SkillMention = Node.create({
    name: SKILL_MENTION_NODE_NAME,
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,

    addAttributes() {
        return {
            name: { default: "" },
            description: { default: "" }
        };
    },

    parseHTML() {
        return [{
            tag: "span[data-skill-mention]",
            getAttrs: (element) => {
                const node = element as HTMLElement;
                return {
                    name: node.dataset.name ?? "",
                    description: node.dataset.description ?? ""
                };
            }
        }];
    },

    renderHTML({ node, HTMLAttributes }) {
        return [
            "span",
            mergeAttributes(HTMLAttributes, {
                "data-skill-mention": "",
                "data-name": node.attrs.name,
                "data-description": node.attrs.description
            }),
            serializedSkillMention(node.attrs.name)
        ];
    },

    renderText({ node }) {
        return serializedSkillMention(node.attrs.name as string);
    },

    addNodeView() {
        return ReactNodeViewRenderer(SkillMentionView);
    }
});

function SkillMentionView({
    node,
    editor,
    getPos,
    deleteNode,
    selected
}: ReactNodeViewProps) {
    const attributes = node.attrs as SelectedSkillMention;
    const label = attributes.name;

    function restoreSkill(): void {
        const position = getPos();
        if (typeof position !== "number" || !label) {
            return;
        }
        const command = serializedSkillMention(attributes.name);
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
                    text: command
                }
            )
            .setTextSelection(position + command.length)
            .run();
    }

    return (
        <TooltipPrimitive.Provider delayDuration={150}>
            <TooltipPrimitive.Root>
                <TooltipPrimitive.Trigger asChild>
                    <NodeViewWrapper
                        as="span"
                        contentEditable={false}
                        data-skill-mention-node=""
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
                                restoreSkill();
                            }}
                            className={cn(
                                "group/skill-mention relative inline-flex min-w-0 max-w-[min(20rem,70vw)] cursor-pointer items-center gap-1",
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
                                <Sparkles className="size-3.5 group-hover/skill-mention:hidden" />
                                <X className="hidden size-3.5 group-hover/skill-mention:block" />
                            </span>
                            <span className="min-w-0 truncate">{label}</span>
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
                            "text-xs leading-5 text-popover-foreground shadow-[0_6px_16px_rgb(0_0_0/0.07)] dark:shadow-[0_8px_20px_rgb(0_0_0/0.38)]"
                        )}
                    >
                        {attributes.description}
                    </TooltipPrimitive.Content>
                </TooltipPrimitive.Portal>
            </TooltipPrimitive.Root>
        </TooltipPrimitive.Provider>
    );
}
