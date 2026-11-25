import type { Editor } from "@tiptap/core";
import {
    PATH_MENTION_NODE_NAME,
    detectPathMention,
    type PathMentionTrigger,
    type SelectedPathMention
} from "./composer-path-mentions.ts";
import {
    positionAtTextOffset,
    serializeDocument,
    textOffsetAt
} from "./composer-rich-text.ts";

export type PathMentionInsertionRange = {
    start: number;
    end: number;
};

export function pathMentionInsertionRange(
    value: string,
    trigger: PathMentionTrigger
): PathMentionInsertionRange {
    return {
        start: trigger.tokenStart > 0 && value[trigger.tokenStart - 1] === " "
            ? trigger.tokenStart - 1
            : trigger.tokenStart,
        end: value[trigger.tokenEnd] === " "
            ? trigger.tokenEnd + 1
            : trigger.tokenEnd
    };
}

export function insertSelectedPathMention(
    editor: Editor,
    mention: SelectedPathMention
): boolean {
    const doc = editor.state.doc;
    const selection = editor.state.selection;
    const value = serializeDocument(doc);
    const trigger = detectPathMention(
        value,
        textOffsetAt(doc, selection.from),
        textOffsetAt(doc, selection.to)
    );
    if (!trigger) {
        return false;
    }

    const range = pathMentionInsertionRange(value, trigger);
    const from = positionAtTextOffset(doc, range.start);
    const to = positionAtTextOffset(doc, range.end);
    if (from === to) {
        return false;
    }
    editor.commands.focus();
    return editor
        .chain()
        .deleteRange({ from, to })
        .insertContentAt(from, {
            type: PATH_MENTION_NODE_NAME,
            attrs: mention
        })
        .setTextSelection(from + 1)
        .run();
}
