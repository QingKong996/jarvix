import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { expect, test } from "vitest";
import { PathMention } from "./PathMentionNode.tsx";
import {
    insertSelectedPathMention,
    pathMentionInsertionRange
} from "./composer-path-insertion.ts";
import {
    detectPathMention,
    type SelectedPathMention
} from "./composer-path-mentions.ts";
import { positionAtTextOffset } from "./composer-rich-text.ts";

const mention: SelectedPathMention = {
    token: "@./index.html",
    path: "C:\\workspace\\index.html",
    name: "index.html",
    kind: "file"
};

test("removes a bare @ when selecting a path", () => {
    const editor = createEditor([{ type: "text", text: "@" }]);
    setCursorAtEnd(editor);

    expect(insertSelectedPathMention(editor, mention)).toBe(true);
    expect(editor.getJSON().content?.[0]?.content).toEqual([{
        type: "pathMention",
        attrs: mention
    }]);
});

test("removes a bare @ after an existing path mention", () => {
    const previous: SelectedPathMention = {
        token: "@./src",
        path: "C:\\workspace\\src",
        name: "src",
        kind: "directory"
    };
    const editor = createEditor([
        {
            type: "pathMention",
            attrs: previous
        },
        {
            type: "text",
            text: " @"
        }
    ]);
    setCursorAtEnd(editor);

    expect(insertSelectedPathMention(editor, mention)).toBe(true);
    expect(editor.getJSON().content?.[0]?.content).toEqual([
        {
            type: "pathMention",
            attrs: previous
        },
        {
            type: "pathMention",
            attrs: mention
        }
    ]);
});

test("selects the complete @ trigger instead of an empty range", () => {
    const trigger = detectPathMention("@", 1);
    expect(trigger).not.toBeNull();
    expect(pathMentionInsertionRange("@", trigger!)).toEqual({
        start: 0,
        end: 1
    });
});

test("returns false without an active path trigger", () => {
    const editor = createEditor([{ type: "text", text: "hello" }]);
    setCursorAtTextOffset(editor, 5);

    expect(insertSelectedPathMention(editor, mention)).toBe(false);
    expect(editor.getJSON().content?.[0]?.content).toEqual([{
        type: "text",
        text: "hello"
    }]);
});

test("returns false when the selection is not collapsed", () => {
    const editor = createEditor([{ type: "text", text: "hello @src" }]);
    editor.commands.setTextSelection({
        from: 1,
        to: 3
    });

    expect(insertSelectedPathMention(editor, mention)).toBe(false);
});

test("preserves surrounding text and removes only the trigger and one boundary space", () => {
    const editor = createEditor([{ type: "text", text: "read @" }]);
    setCursorAtTextOffset(editor, 6);

    expect(insertSelectedPathMention(editor, mention)).toBe(true);
    expect(editor.getJSON().content?.[0]?.content).toEqual([
        {
            type: "text",
            text: "read"
        },
        {
            type: "pathMention",
            attrs: mention
        }
    ]);
    expect(editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n"))
        .toBe("read");
});

test("consumes an existing space after the trigger", () => {
    const editor = createEditor([{ type: "text", text: "@ " }]);
    setCursorAtTextOffset(editor, 1);

    expect(insertSelectedPathMention(editor, mention)).toBe(true);
    expect(editor.getJSON().content?.[0]?.content).toEqual([{
        type: "pathMention",
        attrs: mention
    }]);
});

function createEditor(content: object[]): Editor {
    return new Editor({
        extensions: [Document, Paragraph, Text, PathMention],
        content: {
            type: "doc",
            content: [{
                type: "paragraph",
                content
            }]
        }
    });
}

function setCursorAtEnd(editor: Editor): void {
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
}

function setCursorAtTextOffset(editor: Editor, offset: number): void {
    editor.commands.setTextSelection(positionAtTextOffset(editor.state.doc, offset));
}
