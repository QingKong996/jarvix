import { Node as ProseMirrorNode, Schema } from "@tiptap/pm/model";
import { expect, test } from "vitest";
import {
    positionAtTextOffset,
    serializeDocument,
    textOffsetAt
} from "./composer-rich-text.ts";

const schema = new Schema({
    nodes: {
        doc: {
            content: "block+"
        },
        paragraph: {
            group: "block",
            content: "inline*"
        },
        text: {
            group: "inline"
        },
        hardBreak: {
            inline: true,
            group: "inline",
            selectable: false
        },
        pathMention: {
            inline: true,
            group: "inline",
            atom: true,
            attrs: {
                token: { default: "" },
                path: { default: "" },
                name: { default: "" },
                kind: { default: "file" }
            }
        }
    },
    marks: {}
});

test("maps serialized text offsets inside paragraphs", () => {
    const doc = document([paragraph([text("hello")])]);

    expect(positionAtTextOffset(doc, 0)).toBe(1);
    expect(positionAtTextOffset(doc, 2)).toBe(3);
    expect(positionAtTextOffset(doc, 5)).toBe(6);
    expect(positionAtTextOffset(doc, 99)).toBe(6);
});

test("maps hard breaks without losing a position", () => {
    const doc = document([
        paragraph([text("ab"), { type: "hardBreak" }, text("cd")])
    ]);

    expect(serializeDocument(doc)).toBe("ab\ncd");
    expect(positionAtTextOffset(doc, 2)).toBe(3);
    expect(positionAtTextOffset(doc, 3)).toBe(4);
    expect(positionAtTextOffset(doc, 4)).toBe(5);
    expect(positionAtTextOffset(doc, 5)).toBe(6);
});

test("maps path mention tokens by their serialized length", () => {
    const doc = document([
        paragraph([
            text("see"),
            {
                type: "pathMention",
                attrs: {
                    token: "@src/a.ts",
                    path: "C:\\workspace\\src\\a.ts",
                    name: "a.ts",
                    kind: "file"
                }
            },
            text("ok")
        ])
    ]);

    expect(serializeDocument(doc)).toBe("see @src/a.ts ok");
    expect(positionAtTextOffset(doc, 3)).toBe(4);
    expect(positionAtTextOffset(doc, 4)).toBe(5);
    expect(positionAtTextOffset(doc, 13)).toBe(5);
    expect(positionAtTextOffset(doc, 14)).toBe(5);
    expect(positionAtTextOffset(doc, 15)).toBe(6);
    expect(textOffsetAt(doc, 5)).toBe(14);
});

test("serializes leading and trailing spacing into the mention atom", () => {
    const doc = document([
        paragraph([{
            type: "pathMention",
            attrs: {
                token: "@index.html",
                path: "C:\\workspace\\index.html",
                name: "index.html",
                kind: "file"
            }
        }])
    ]);

    expect(serializeDocument(doc)).toBe(" @index.html ");
    expect(textOffsetAt(doc, 2)).toBe(13);
    expect(positionAtTextOffset(doc, 13)).toBe(2);
});

test("maps offsets across adjacent and hard-break-separated mentions", () => {
    const doc = document([
        paragraph([
            {
                type: "pathMention",
                attrs: {
                    token: "@a",
                    path: "C:\\workspace\\a",
                    name: "a",
                    kind: "file"
                }
            },
            {
                type: "pathMention",
                attrs: {
                    token: "@b",
                    path: "C:\\workspace\\b",
                    name: "b",
                    kind: "file"
                }
            },
            { type: "hardBreak" },
            text("tail")
        ])
    ]);

    expect(serializeDocument(doc)).toBe(" @a  @b \ntail");
    expect(textOffsetAt(doc, 3)).toBe(8);
    expect(positionAtTextOffset(doc, 8)).toBe(3);
    expect(textOffsetAt(doc, 4)).toBe(9);
    expect(positionAtTextOffset(doc, 10)).toBe(5);
});

test("keeps empty and multiple paragraphs inside the document", () => {
    const empty = document([paragraph([])]);
    expect(positionAtTextOffset(empty, 0)).toBe(1);

    const doc = document([
        paragraph([text("a")]),
        paragraph([text("bc")])
    ]);
    expect(serializeDocument(doc)).toBe("a\nbc");
    expect(positionAtTextOffset(doc, 1)).toBe(2);
    expect(positionAtTextOffset(doc, 2)).toBe(4);
    expect(positionAtTextOffset(doc, 4)).toBe(6);
});

function document(content: object[]): ProseMirrorNode {
    return ProseMirrorNode.fromJSON(schema, {
        type: "doc",
        content
    });
}

function paragraph(content: object[]): object {
    return {
        type: "paragraph",
        content
    };
}

function text(value: string): object {
    return {
        type: "text",
        text: value
    };
}
