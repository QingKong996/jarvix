import { describe, expect, test } from "vitest";
import {
    cycleCommandIndex,
    detectSlashCommand,
    filterSlashCommands,
    parseGoalCommand,
    removeSlashCommandToken
} from "./composer-commands.ts";

const commands = [
    {
        id: "alpha",
        label: "Alpha",
        description: "显示 Alpha 服务状态",
        keywords: ["server"]
    },
    {
        id: "beta",
        label: "测试",
        description: "发送有关此聊天的反馈"
    },
    {
        id: "gamma",
        label: "工作树",
        description: "开启工作树模式"
    },
    {
        id: "delta",
        label: "状态",
        description: "显示聊天 ID、上下文用量和速率限制"
    }
];

describe("detectSlashCommand", () => {
    test("detects a slash command on the active line only", () => {
        expect(detectSlashCommand("hello\n/mc", 9)).toEqual({
            query: "mc",
            tokenStart: 6,
            tokenEnd: 9
        });
        expect(detectSlashCommand("hello /mc", 9)).toBeNull();
        expect(detectSlashCommand("hello\n/mc\nnext", 13)).toBeNull();
        expect(detectSlashCommand("/mcp extra", 4)).toBeNull();
    });

    test("handles CRLF line endings", () => {
        expect(detectSlashCommand("/goal\r\nsecond", 5)).toEqual({
            query: "goal",
            tokenStart: 0,
            tokenEnd: 5
        });
        expect(detectSlashCommand("first\r\n/wo", 10)).toEqual({
            query: "wo",
            tokenStart: 7,
            tokenEnd: 10
        });
    });

    test("requires a collapsed cursor and a line-start slash", () => {
        expect(detectSlashCommand("/goal", 5, 4)).toBeNull();
        expect(detectSlashCommand(" /goal", 6)).toBeNull();
        expect(detectSlashCommand("text /goal", 10)).toBeNull();
    });
});

describe("filterSlashCommands", () => {
    test("matches prefixes, nested characters, and translated descriptions", () => {
        expect(filterSlashCommands(commands, "gm")[0]?.id).toBe("gamma");
        expect(filterSlashCommands(commands, "反馈")[0]?.id).toBe("beta");
        expect(filterSlashCommands(commands, "上下文")[0]?.id).toBe("delta");
    });

    test("keeps the catalog order for an empty query", () => {
        expect(filterSlashCommands(commands, "").map((command) => command.id))
            .toEqual(commands.map((command) => command.id));
    });
});

describe("command navigation", () => {
    test("wraps forward and backward and handles an empty list", () => {
        expect(cycleCommandIndex(0, 1, 3)).toBe(1);
        expect(cycleCommandIndex(2, 1, 3)).toBe(0);
        expect(cycleCommandIndex(0, -1, 3)).toBe(2);
        expect(cycleCommandIndex(0, 2, 3)).toBe(2);
        expect(cycleCommandIndex(0, 1, 0)).toBe(-1);
    });

    test("removes a selected command token and one trailing space", () => {
        expect(removeSlashCommandToken("before\n/go\nnext", {
            query: "go",
            tokenStart: 7,
            tokenEnd: 10
        })).toEqual({
            value: "before\n\nnext",
            caret: 7
        });
        expect(removeSlashCommandToken("/goal ", {
            query: "goal",
            tokenStart: 0,
            tokenEnd: 5
        })).toEqual({
            value: "",
            caret: 0
        });
    });
});

describe("parseGoalCommand", () => {
    test("extracts inline and multiline goal content", () => {
        expect(parseGoalCommand("/goal 实现功能 A")).toEqual({
            content: "实现功能 A"
        });
        expect(parseGoalCommand("/GOAL\t实现功能 A")).toEqual({
            content: "实现功能 A"
        });
        expect(parseGoalCommand("/goal\n实现功能 A\n并补全测试")).toEqual({
            content: "实现功能 A\n并补全测试"
        });
        expect(parseGoalCommand("/goal\r\n实现功能 A\r\n")).toEqual({
            content: "实现功能 A"
        });
        expect(parseGoalCommand("实现功能 A\n/goal")).toEqual({
            content: "实现功能 A"
        });
    });

    test("returns an empty goal for the bare command", () => {
        expect(parseGoalCommand("/goal")).toEqual({ content: "" });
        expect(parseGoalCommand("/GOAL\n\n")).toEqual({ content: "" });
        expect(parseGoalCommand("/goal \t \r\n")).toEqual({ content: "" });
    });

    test("ignores commands that are not complete tokens at line start", () => {
        expect(parseGoalCommand("/goals")).toBeNull();
        expect(parseGoalCommand("hello /goal")).toBeNull();
        expect(parseGoalCommand("  /goal")).toBeNull();
    });

    test("uses the first complete goal command in the message", () => {
        expect(parseGoalCommand(
            "before\n/goal first\nmiddle\n/GOAL second\nafter"
        )).toEqual({
            content: "before\nfirst\nmiddle\n/GOAL second\nafter"
        });
    });
});
