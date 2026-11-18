import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { beforeAll, describe, expect, test } from "vitest";
import { i18n } from "../../../../i18n/index.ts";
import { ContextMessage } from "./ContextMessage.tsx";
import { contextMessagesFor } from "./context-messages.ts";

beforeAll(async () => {
    await i18n.changeLanguage("zh");
});

describe("ContextMessage", () => {
    test("renders only the four message types and their raw text", () => {
        const messages = contextMessagesFor({
            systemPrompt: "system prompt",
            messages: [
                {
                    role: "system",
                    content: "<environment_context>workspace</environment_context>",
                    timestamp: 1
                },
                {
                    role: "user",
                    content: "hello",
                    timestamp: 2
                },
                {
                    role: "assistant",
                    content: [{
                        type: "toolCall",
                        id: "call-1",
                        name: "exec_command",
                        arguments: { command: "pwd" }
                    }],
                    provider: "test",
                    model: "test",
                    api: "test",
                    usage: {
                        inputTokens: 0,
                        outputTokens: 0,
                        cacheReadTokens: 0,
                        cacheWriteTokens: 0,
                        totalTokens: 0,
                        cost: 0
                    },
                    stopReason: "toolUse",
                    timestamp: 3
                },
                {
                    role: "toolResult",
                    toolCallId: "call-1",
                    toolName: "exec_command",
                    content: "C:\\workspace",
                    isError: false,
                    timestamp: 4
                }
            ]
        });
        const html = renderToStaticMarkup(
            <I18nextProvider i18n={i18n}>
                {messages.map((entry, index) => (
                    <ContextMessage key={index} entry={entry} />
                ))}
            </I18nextProvider>
        );

        expect(html.match(/>系统消息</g)).toHaveLength(2);
        expect(html.match(/>用户</g)).toHaveLength(1);
        expect(html.match(/>助手</g)).toHaveLength(1);
        expect(html.match(/>工具结果</g)).toHaveLength(1);
        expect(html).toContain("system prompt");
        expect(html).toContain("&lt;environment_context&gt;");
        expect(html).toContain("hello");
        expect(html).toContain("exec_command");
        expect(html).toContain("C:\\workspace");
        expect(html).not.toContain("环境快照");
        expect(html).not.toContain("系统提示词");
        expect(html).not.toContain("#02");
        expect(html.match(/<details/g)).toHaveLength(5);
        expect(html).not.toContain("<details open");
        expect(html).toContain("exec_command · {&quot;command&quot;:&quot;pwd&quot;}");
    });
});
