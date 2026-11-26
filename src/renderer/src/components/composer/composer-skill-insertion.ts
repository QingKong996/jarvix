import type { Editor } from "@tiptap/core";
import {
    positionAtTextOffset
} from "./composer-rich-text.ts";
import {
    SKILL_MENTION_NODE_NAME,
    type SelectedSkillMention
} from "./composer-skill-mentions.ts";

export function replaceRangeWithSkillMention(
    editor: Editor,
    start: number,
    end: number,
    mention: SelectedSkillMention
): boolean {
    if (end <= start) {
        return false;
    }

    const doc = editor.state.doc;
    const from = positionAtTextOffset(doc, start);
    const to = positionAtTextOffset(doc, end);
    editor.commands.focus();
    return editor
        .chain()
        .deleteRange({ from, to })
        .insertContentAt(from, [
            {
                type: SKILL_MENTION_NODE_NAME,
                attrs: mention
            },
            {
                type: "text",
                text: " "
            }
        ])
        .setTextSelection(from + 2)
        .run();
}
