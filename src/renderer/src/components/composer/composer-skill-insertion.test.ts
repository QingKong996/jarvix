import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { expect, test } from "vitest";
import { SkillMention } from "./SkillMentionNode.tsx";
import { replaceRangeWithSkillMention } from "./composer-skill-insertion.ts";
import { serializeDocument } from "./composer-rich-text.ts";

test("replaces a slash command with a skill mention chip", () => {
    const editor = new Editor({
        extensions: [Document, Paragraph, Text, SkillMention],
        content: {
            type: "doc",
            content: [{
                type: "paragraph",
                content: [{ type: "text", text: "/tdd" }]
            }]
        }
    });

    expect(replaceRangeWithSkillMention(editor, 0, 4, {
        name: "tdd",
        description: "Test-driven development"
    })).toBe(true);
    expect(editor.getJSON().content?.[0]?.content).toEqual([
        {
            type: "skillMention",
            attrs: {
                name: "tdd",
                description: "Test-driven development"
            }
        },
        {
            type: "text",
            text: " "
        }
    ]);
    expect(serializeDocument(editor.state.doc)).toBe("/tdd ");
});
