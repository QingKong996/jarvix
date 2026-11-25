import type {
    JarvixPathCompletion,
    JarvixPathKind
} from "../../../../protocol/path-completion.ts";

export const PATH_MENTION_NODE_NAME = "pathMention";

export type PathMentionTrigger = {
    query: string;
    tokenStart: number;
    tokenEnd: number;
};

export type SelectedPathMention = {
    token: string;
    path: string;
    name: string;
    kind: JarvixPathKind;
};

export type ResolvedPathMentions = {
    text: string;
    paths: string[];
};

export type CompletedPathText = {
    token: string;
    value: string;
    caret: number;
    trigger: PathMentionTrigger | null;
};

const EMAIL_LOCAL_CHARACTER = /[A-Za-z0-9._%+-]/u;
const TOKEN_SUFFIX_CHARACTER = /[A-Za-z0-9._%+\\/-]/u;

export function detectPathMention(
    value: string,
    selectionStart: number,
    selectionEnd: number = selectionStart
): PathMentionTrigger | null {
    const start = Math.max(0, Math.min(selectionStart, value.length));
    const end = Math.max(0, Math.min(selectionEnd, value.length));
    if (start !== end) {
        return null;
    }

    const lineStart = Math.max(
        value.lastIndexOf("\n", start - 1),
        value.lastIndexOf("\r", start - 1)
    ) + 1;
    for (let index = start - 1; index >= lineStart; index -= 1) {
        if (value[index] !== "@" || !isMentionBoundary(value, index)) {
            continue;
        }

        if (value[index + 1] === "\"") {
            const closeQuote = value.indexOf("\"", index + 2);
            if (closeQuote !== -1 && closeQuote + 1 < start) {
                continue;
            }
            const queryEnd = closeQuote !== -1 && start > closeQuote
                ? closeQuote
                : start;
            return {
                query: value.slice(index + 2, queryEnd),
                tokenStart: index,
                tokenEnd: closeQuote === -1 ? start : closeQuote + 1
            };
        }

        if (/\s/u.test(value.slice(index + 1, start))) {
            continue;
        }
        let tokenEnd = start;
        while (tokenEnd < value.length && !/\s/u.test(value[tokenEnd]!)) {
            tokenEnd += 1;
        }
        return {
            query: value.slice(index + 1, tokenEnd),
            tokenStart: index,
            tokenEnd
        };
    }
    return null;
}

export function pathMentionFor(
    completion: JarvixPathCompletion,
    absolute = false
): SelectedPathMention {
    const displayPath = absolute
        ? completion.path
        : completion.relativePath || completion.path;
    const token = /[\s"]/u.test(displayPath)
        ? `@"${displayPath.replace(/"/gu, "\\\"")}"`
        : `@${displayPath}`;
    return {
        token,
        path: completion.path,
        name: completion.name,
        kind: completion.kind
    };
}

export function serializedPathMention(token: string): string {
    return ` ${token} `;
}

export function completePathMentionText(
    value: string,
    trigger: PathMentionTrigger,
    completion: JarvixPathCompletion
): CompletedPathText {
    const { token } = pathMentionFor(completion);
    const nextValue = [
        value.slice(0, trigger.tokenStart),
        token,
        value.slice(trigger.tokenEnd)
    ].join("");
    const caret = trigger.tokenStart + token.length;
    return {
        token,
        value: nextValue,
        caret,
        trigger: detectPathMention(nextValue, caret)
    };
}

export function resolvePathMentions(
    value: string,
    mentions: readonly SelectedPathMention[]
): ResolvedPathMentions {
    const active = [...new Map(
        mentions
            .filter((mention) => containsMention(value, mention.token))
            .map((mention) => [mention.token, mention])
    ).values()].sort((left, right) => right.token.length - left.token.length);

    let text = value;
    for (const mention of active) {
        text = replaceMention(text, mention.token, promptPath(mention.path));
    }
    return {
        text,
        paths: [...new Set(active.map((mention) => mention.path))]
    };
}

function isMentionBoundary(value: string, index: number): boolean {
    if (index === 0) {
        return true;
    }
    return !EMAIL_LOCAL_CHARACTER.test(value[index - 1]!);
}

function containsMention(value: string, token: string): boolean {
    let index = value.indexOf(token);
    while (index !== -1) {
        if (isTokenStart(value, index) && isTokenEnd(value, index + token.length)) {
            return true;
        }
        index = value.indexOf(token, index + 1);
    }
    return false;
}

function replaceMention(value: string, token: string, replacement: string): string {
    let output = "";
    let cursor = 0;
    let index = value.indexOf(token);
    while (index !== -1) {
        const tokenEnd = index + token.length;
        if (isTokenStart(value, index) && isTokenEnd(value, tokenEnd)) {
            output += value.slice(cursor, index) + replacement;
            cursor = tokenEnd;
        }
        index = value.indexOf(token, index + 1);
    }
    return output + value.slice(cursor);
}

function isTokenStart(value: string, index: number): boolean {
    return index === 0 || isMentionBoundary(value, index);
}

function isTokenEnd(value: string, index: number): boolean {
    return index >= value.length || !TOKEN_SUFFIX_CHARACTER.test(value[index]!);
}

function promptPath(path: string): string {
    return /[\s"]/u.test(path)
        ? `"${path.replace(/"/gu, "\\\"")}"`
        : path;
}
