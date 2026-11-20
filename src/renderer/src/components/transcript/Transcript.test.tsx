import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { beforeAll, expect, test, vi } from "vitest";
import { i18n } from "../../../../i18n/index.ts";
import { Transcript } from "./Transcript.tsx";

const { committed } = vi.hoisted(() => ({
    committed: Array.from({ length: 120 }, (_, index) => ({
        id: `turn-${index}`,
        role: "user" as const,
        text: `message-${String(index).padStart(3, "0")}`,
        blocks: [],
        error: null,
        reason: null
    }))
}));

vi.mock("./state/transcript-hooks.ts", () => ({
    useCommitted: () => committed,
    useLive: () => null,
    useInjected: () => []
}));

beforeAll(async () => {
    await i18n.changeLanguage("zh");
});

test("renders every committed turn without a default history window", () => {
    const html = renderToStaticMarkup(
        <I18nextProvider i18n={i18n}>
            <Transcript sessionId="session-test" />
        </I18nextProvider>
    );

    expect(html.match(/message-\d{3}/g)).toHaveLength(committed.length);
    expect(html).toContain("message-000");
    expect(html).toContain("message-119");
    expect(html).not.toContain("加载更早");
});
