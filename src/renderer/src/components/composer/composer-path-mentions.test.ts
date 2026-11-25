import { describe, expect, test } from "vitest";
import {
    completePathMentionText,
    detectPathMention,
    pathMentionFor,
    resolvePathMentions
} from "./composer-path-mentions.ts";

describe("detectPathMention", () => {
    test("detects a bare @ trigger", () => {
        expect(detectPathMention("@", 1)).toEqual({
            query: "",
            tokenStart: 0,
            tokenEnd: 1
        });
    });

    test("detects path queries anywhere on the active line", () => {
        const value = "please @src/fo";
        expect(detectPathMention(value, value.length)).toEqual({
            query: "src/fo",
            tokenStart: 7,
            tokenEnd: value.length
        });
        expect(detectPathMention("请看@src/fo", 9)).toEqual({
            query: "src/fo",
            tokenStart: 2,
            tokenEnd: 9
        });
    });

    test("supports quoted paths and ignores closed mentions", () => {
        const value = "open @\"C:\\My Dir";
        expect(detectPathMention(value, value.length)).toEqual({
            query: "C:\\My Dir",
            tokenStart: 5,
            tokenEnd: value.length
        });
        expect(detectPathMention("open @\"C:\\My Dir\" ", 18)).toBeNull();
        expect(detectPathMention("open @\"C:\\My Dir\"", 17)).toEqual({
            query: "C:\\My Dir",
            tokenStart: 5,
            tokenEnd: 17
        });
    });

    test("ignores email addresses and selections", () => {
        expect(detectPathMention("user@example.com", 16)).toBeNull();
        expect(detectPathMention("@src/foo", 7, 6)).toBeNull();
    });
});

describe("path mentions", () => {
    test("completes a candidate as text without confirming a grant", () => {
        const value = "@./fo";
        const trigger = detectPathMention(value, value.length)!;
        const completed = completePathMentionText(value, trigger, {
            path: "C:\\workspace\\foo.txt",
            relativePath: "./foo.txt",
            name: "foo.txt",
            kind: "file"
        });

        expect(completed).toMatchObject({
            token: "@./foo.txt",
            value: "@./foo.txt",
            caret: 10,
            trigger: {
                query: "./foo.txt",
                tokenStart: 0,
                tokenEnd: 10
            }
        });
    });

    test("keeps the completion menu active for quoted paths", () => {
        const value = "@\"./My ";
        const trigger = detectPathMention(value, value.length)!;
        const completed = completePathMentionText(value, trigger, {
            path: "C:\\workspace\\My File.txt",
            relativePath: "./My File.txt",
            name: "My File.txt",
            kind: "file"
        });

        expect(completed).toMatchObject({
            token: "@\"./My File.txt\"",
            value: "@\"./My File.txt\"",
            trigger: {
                query: "./My File.txt"
            }
        });
    });

    test("inserts relative paths and quotes paths with spaces", () => {
        expect(pathMentionFor({
            path: "C:\\workspace\\src\\file.ts",
            relativePath: "./src/file.ts",
            name: "file.ts",
            kind: "file"
        })).toEqual({
            token: "@./src/file.ts",
            path: "C:\\workspace\\src\\file.ts",
            name: "file.ts",
            kind: "file"
        });
        expect(pathMentionFor({
            path: "C:\\workspace\\My File.ts",
            relativePath: "./My File.ts",
            name: "My File.ts",
            kind: "file"
        }).token).toBe("@\"./My File.ts\"");
        expect(pathMentionFor({
            path: "C:\\workspace\\My File.ts",
            relativePath: "./My File.ts",
            name: "My File.ts",
            kind: "file"
        }, true).token).toBe("@\"C:\\workspace\\My File.ts\"");
    });

    test("replaces selected mentions with absolute paths and de-duplicates grants", () => {
        const path = "C:\\workspace\\src\\foo.ts";
        const resolved = resolvePathMentions(
            "read @./src/foo.ts and @./src/foo.ts again",
            [{ token: "@./src/foo.ts", path, name: "foo.ts", kind: "file" }]
        );

        expect(resolved.text).toBe(`read ${path} and ${path} again`);
        expect(resolved.paths).toEqual([path]);
    });

    test("quotes prompt paths with spaces and skips deleted mentions", () => {
        const path = "C:\\workspace\\My File.ts";
        const token = "@\"My File.ts\"";

        expect(resolvePathMentions(`open ${token}`, [{
            token,
            path,
            name: "My File.ts",
            kind: "file"
        }])).toEqual({
            text: `open "${path}"`,
            paths: [path]
        });
        expect(resolvePathMentions("open nothing", [{
            token,
            path,
            name: "My File.ts",
            kind: "file"
        }])).toEqual({
            text: "open nothing",
            paths: []
        });
    });

    test("does not resolve a mention inside a longer token", () => {
        const path = "C:\\workspace\\src\\foo.ts";
        expect(resolvePathMentions("@./src/foo.ts", [{
            token: "@./src/foo",
            path,
            name: "foo.ts",
            kind: "file"
        }])).toEqual({
            text: "@./src/foo.ts",
            paths: []
        });
    });

    test("resolves adjacent leading and trailing mentions", () => {
        const first = "C:\\workspace\\first.ts";
        const second = "C:\\workspace\\second.ts";
        const resolved = resolvePathMentions(
            " @./first.ts @./second.ts ",
            [
                {
                    token: "@./first.ts",
                    path: first,
                    name: "first.ts",
                    kind: "file"
                },
                {
                    token: "@./second.ts",
                    path: second,
                    name: "second.ts",
                    kind: "file"
                }
            ]
        );

        expect(resolved.text).toBe(` ${first} ${second} `);
        expect(new Set(resolved.paths)).toEqual(new Set([first, second]));
    });
});
