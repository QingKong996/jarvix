import {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent
} from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import Document from "@tiptap/extension-document";
import HardBreak from "@tiptap/extension-hard-break";
import History from "@tiptap/extension-history";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import type { SelectedPathMention } from "./composer-path-mentions.ts";
import { insertSelectedPathMention } from "./composer-path-insertion.ts";
import {
    mentionsFromDocument,
    positionAtTextOffset,
    serializeDocument,
    textOffsetAt
} from "./composer-rich-text.ts";
import { PathMention } from "./PathMentionNode.tsx";

export type EditorSelection = {
    start: number;
    end: number;
};

export type EditorSnapshot = {
    value: string;
    mentions: SelectedPathMention[];
    selection: EditorSelection;
};

export type ComposerRichInputHandle = {
    focus(): void;
    clear(): void;
    replaceRange(start: number, end: number, text: string): void;
    insertMention(mention: SelectedPathMention): boolean;
    setPlainText(text: string): void;
};

type ComposerRichInputProps = {
    disabled: boolean;
    placeholder: string;
    ariaLabel: string;
    ariaExpanded: boolean;
    ariaControls?: string;
    ariaActiveDescendant?: string;
    onChange(snapshot: EditorSnapshot): void;
    onSelectionChange(selection: EditorSelection): void;
    onFocus(): void;
    onBlur(): void;
    onKeyDown(event: KeyboardEvent<HTMLDivElement>): void;
};

const extensions = [
    Document,
    Paragraph,
    Text,
    HardBreak,
    History,
    PathMention
];

export const ComposerRichInput = forwardRef<
    ComposerRichInputHandle,
    ComposerRichInputProps
>(function ComposerRichInput({
    disabled,
    placeholder,
    ariaLabel,
    ariaExpanded,
    ariaControls,
    ariaActiveDescendant,
    onChange,
    onSelectionChange,
    onFocus,
    onBlur,
    onKeyDown
}, ref) {
    const callbacks = useRef({
        onChange,
        onSelectionChange,
        onFocus,
        onBlur
    });
    callbacks.current = {
        onChange,
        onSelectionChange,
        onFocus,
        onBlur
    };
    const [empty, setEmpty] = useState(true);
    const editorOptions = useMemo(() => ({
        extensions,
        content: "",
        editorProps: {
            attributes: {
                class: "composer-prosemirror min-h-8 max-h-48 overflow-y-auto whitespace-pre-wrap break-words px-1.5 py-1.5 text-sm outline-none",
                role: "textbox",
                "aria-multiline": "true",
                "aria-autocomplete": "list",
                "aria-haspopup": "listbox",
                "data-testid": "composer-input"
            }
        },
        onUpdate: ({ editor: current }: { editor: Editor }) => {
            const snapshot = editorSnapshot(current);
            setEmpty(snapshot.value.length === 0);
            callbacks.current.onChange(snapshot);
        },
        onSelectionUpdate: ({ editor: current }: { editor: Editor }) => {
            callbacks.current.onSelectionChange(selectionSnapshot(current));
        },
        onFocus: () => callbacks.current.onFocus(),
        onBlur: () => callbacks.current.onBlur()
    }), []);
    const editor = useEditor(editorOptions);

    useEffect(() => {
        if (!editor) {
            return;
        }
        editor.setEditable(!disabled);
        const dom = editor.view.dom;
        dom.setAttribute("aria-label", ariaLabel);
        dom.setAttribute("aria-expanded", String(ariaExpanded));
        setOptionalAttribute(dom, "aria-controls", ariaControls);
        setOptionalAttribute(dom, "aria-activedescendant", ariaActiveDescendant);
    }, [
        ariaActiveDescendant,
        ariaControls,
        ariaExpanded,
        ariaLabel,
        disabled,
        editor
    ]);

    useImperativeHandle(ref, () => ({
        focus() {
            editor?.commands.focus();
        },
        clear() {
            editor?.commands.clearContent(true);
            editor?.commands.focus();
        },
        replaceRange(start, end, text) {
            if (!editor) {
                return;
            }
            replaceTextRange(editor, start, end, text);
        },
        insertMention(mention) {
            if (!editor) {
                return false;
            }
            return insertSelectedPathMention(editor, mention);
        },
        setPlainText(text) {
            if (!editor) {
                return;
            }
            setPlainText(editor, text);
        }
    }), [editor]);

    useEffect(() => {
        if (!editor || disabled) {
            return;
        }
        editor.commands.focus("end");
    }, [disabled, editor]);

    return (
        <div
            className="relative min-h-8 w-full"
            onKeyDownCapture={onKeyDown}
        >
            <EditorContent editor={editor} />
            {empty ? (
                <span className="pointer-events-none absolute inset-x-1.5 top-1.5 truncate text-sm text-muted-foreground">
                    {placeholder}
                </span>
            ) : null}
        </div>
    );
});

function editorSnapshot(editor: Editor): EditorSnapshot {
    return {
        value: serializeDocument(editor.state.doc),
        mentions: mentionsFromDocument(editor.state.doc),
        selection: selectionSnapshot(editor)
    };
}

function selectionSnapshot(editor: Editor): EditorSelection {
    const { from, to } = editor.state.selection;
    return {
        start: textOffsetAt(editor.state.doc, from),
        end: textOffsetAt(editor.state.doc, to)
    };
}

function replaceTextRange(
    editor: Editor,
    start: number,
    end: number,
    text: string
): void {
    const from = positionAtTextOffset(editor.state.doc, start);
    const to = positionAtTextOffset(editor.state.doc, end);
    editor
        .chain()
        .focus()
        .deleteRange({ from, to })
        .insertContentAt(from, text ? { type: "text", text } : [])
        .setTextSelection(from + text.length)
        .run();
}

function setPlainText(editor: Editor, text: string): void {
    const content = text
        .split(/\r\n|\n|\r/u)
        .flatMap((line, index) => [
            ...(index > 0 ? [{ type: "hardBreak" }] : []),
            ...(line ? [{ type: "text", text: line }] : [])
        ]);
    editor.commands.setContent({
        type: "doc",
        content: [{
            type: "paragraph",
            content
        }]
    });
    editor.commands.focus("end");
}

function setOptionalAttribute(
    element: HTMLElement,
    name: string,
    value: string | undefined
): void {
    if (value) {
        element.setAttribute(name, value);
    } else {
        element.removeAttribute(name);
    }
}
