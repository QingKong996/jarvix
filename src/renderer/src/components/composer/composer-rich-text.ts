import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
    PATH_MENTION_NODE_NAME,
    serializedPathMention,
    type SelectedPathMention
} from "./composer-path-mentions.ts";
import {
    SKILL_MENTION_NODE_NAME,
    serializedSkillMention
} from "./composer-skill-mentions.ts";

const HARD_BREAK_NODE_NAME = "hardBreak";

export function serializeDocument(doc: ProseMirrorNode): string {
    return doc.textBetween(0, doc.content.size, "\n", serializedLeafText);
}

export function textOffsetAt(
    doc: ProseMirrorNode,
    position: number
): number {
    return doc.textBetween(0, position, "\n", serializedLeafText).length;
}

export function mentionsFromDocument(
    doc: ProseMirrorNode
): SelectedPathMention[] {
    const mentions: SelectedPathMention[] = [];
    doc.descendants((node) => {
        if (node.type.name === PATH_MENTION_NODE_NAME) {
            mentions.push({
                token: node.attrs.token as string,
                path: node.attrs.path as string,
                name: node.attrs.name as string,
                kind: node.attrs.kind === "directory" ? "directory" : "file"
            });
        }
    });
    return mentions;
}

export function positionAtTextOffset(
    doc: ProseMirrorNode,
    target: number
): number {
    const desired = Math.max(0, target);
    let consumed = 0;
    let lastInsidePosition = doc.content.size > 0 ? 1 : 0;
    let found: number | null = null;
    let firstTextblock = true;

    doc.forEach((block, blockOffset) => {
        if (found !== null) {
            return;
        }

        const blockStart = blockOffset + 1;
        lastInsidePosition = blockStart + block.content.size;
        if (!block.isTextblock) {
            return;
        }

        if (!firstTextblock) {
            if (desired <= consumed) {
                found = blockStart;
                return;
            }
            consumed += 1;
        }
        firstTextblock = false;

        if (desired <= consumed) {
            found = blockStart;
            return;
        }

        block.descendants((node, offset) => {
            if (found !== null) {
                return false;
            }
            if (!node.isText && !node.isLeaf) {
                return true;
            }

            const length = serializedNodeLength(node);
            if (length === 0) {
                return true;
            }

            const nodeStart = blockStart + offset;
            const nodeEnd = consumed + length;
            if (desired <= consumed) {
                found = nodeStart;
                return false;
            }
            if (desired < nodeEnd) {
                found = node.isText
                    ? nodeStart + desired - consumed
                    : nodeStart + 1;
                return false;
            }
            if (desired === nodeEnd) {
                found = nodeStart + (node.isText ? length : node.nodeSize);
                return false;
            }

            consumed = nodeEnd;
            return true;
        });
    });

    return found ?? lastInsidePosition;
}

function serializedNodeLength(node: ProseMirrorNode): number {
    return node.isText
        ? node.text?.length ?? 0
        : serializedLeafText(node).length;
}

function serializedLeafText(node: ProseMirrorNode): string {
    if (node.type.name === PATH_MENTION_NODE_NAME) {
        return serializedPathMention(node.attrs.token as string);
    }
    if (node.type.name === SKILL_MENTION_NODE_NAME) {
        return serializedSkillMention(node.attrs.name as string);
    }
    if (node.type.name === HARD_BREAK_NODE_NAME) {
        return "\n";
    }
    return node.textContent;
}
