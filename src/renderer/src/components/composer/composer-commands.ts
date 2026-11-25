export type SlashCommand = {
    id: string;
    label: string;
    description: string;
    keywords?: readonly string[];
};

export type SlashCommandTrigger = {
    query: string;
    tokenStart: number;
    tokenEnd: number;
};

export type GoalCommandMatch = {
    content: string;
};

export type CommandTextEdit = {
    value: string;
    caret: number;
};

export function detectSlashCommand(
    value: string,
    selectionStart: number,
    selectionEnd: number = selectionStart
): SlashCommandTrigger | null {
    const start = Math.max(0, Math.min(selectionStart, value.length));
    const end = Math.max(0, Math.min(selectionEnd, value.length));
    if (start !== end) {
        return null;
    }

    const lineStart = Math.max(
        value.lastIndexOf("\n", start - 1),
        value.lastIndexOf("\r", start - 1)
    ) + 1;
    if (start === lineStart || value[lineStart] !== "/") {
        return null;
    }

    let tokenEnd = value.length;
    for (let index = lineStart; index < value.length; index += 1) {
        if (value[index] === "\n" || value[index] === "\r") {
            tokenEnd = index;
            break;
        }
    }
    const token = value.slice(lineStart + 1, tokenEnd);
    if (/\s/u.test(token)) {
        return null;
    }

    return {
        query: token,
        tokenStart: lineStart,
        tokenEnd
    };
}

export function parseGoalCommand(value: string): GoalCommandMatch | null {
    const lines = value.split(/\r\n|\n|\r/u);
    const commandIndex = lines.findIndex((line) => {
        if (line.slice(0, 5).toLowerCase() !== "/goal") {
            return false;
        }
        const next = line[5];
        return next === undefined || next === " " || next === "\t";
    });
    if (commandIndex === -1) {
        return null;
    }

    const commandLine = lines[commandIndex]!;
    const remainder = commandLine.slice(5).replace(/^[ \t]+/u, "");
    const content = [
        ...lines.slice(0, commandIndex),
        ...(remainder ? [remainder] : []),
        ...lines.slice(commandIndex + 1)
    ].join("\n").trim();
    return { content };
}

export function filterSlashCommands<T extends SlashCommand>(
    commands: readonly T[],
    query: string
): T[] {
    const normalizedQuery = normalize(query);
    if (!normalizedQuery) {
        return [...commands];
    }

    return commands
        .map((command, index) => ({
            command,
            index,
            score: commandScore(command, normalizedQuery)
        }))
        .filter((match) => match.score !== null)
        .sort((left, right) => right.score! - left.score! || left.index - right.index)
        .map((match) => match.command);
}

export function cycleCommandIndex(
    activeIndex: number,
    delta: number,
    count: number
): number {
    if (count <= 0) {
        return -1;
    }
    return ((activeIndex + delta) % count + count) % count;
}

export function removeSlashCommandToken(
    value: string,
    trigger: SlashCommandTrigger
): CommandTextEdit {
    const removalEnd = value[trigger.tokenEnd] === " "
        ? trigger.tokenEnd + 1
        : trigger.tokenEnd;
    return {
        value: [
            value.slice(0, trigger.tokenStart),
            value.slice(removalEnd)
        ].join(""),
        caret: trigger.tokenStart
    };
}

function commandScore(command: SlashCommand, query: string): number | null {
    const scores = [
        textScore(query, command.label, 4),
        textScore(query, command.id, 4),
        textScore(query, command.description, 1.5),
        ...(command.keywords ?? []).map((keyword) => textScore(query, keyword, 2))
    ].filter((score): score is number => score !== null);

    return scores.length > 0 ? Math.max(...scores) : null;
}

function textScore(query: string, text: string, weight: number): number | null {
    const normalizedText = normalize(text);
    if (!normalizedText) {
        return null;
    }

    if (normalizedText === query) {
        return 120 * weight;
    }

    if (normalizedText.startsWith(query)) {
        return 100 * weight - normalizedText.length / 100;
    }

    const index = normalizedText.indexOf(query);
    if (index !== -1) {
        return 80 * weight - index / 10 - normalizedText.length / 100;
    }

    const score = subsequenceScore(query, normalizedText);
    return score === null ? null : 40 * weight + score;
}

function subsequenceScore(query: string, text: string): number | null {
    let queryIndex = 0;
    let previousIndex = -2;
    let score = 0;

    for (let index = 0; index < text.length; index += 1) {
        if (text[index] !== query[queryIndex]) {
            continue;
        }

        score += index === previousIndex + 1 ? 8 : 3;
        previousIndex = index;
        queryIndex += 1;
        if (queryIndex === query.length) {
            return score - index / 100;
        }
    }

    return null;
}

function normalize(value: string): string {
    return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu, "");
}
