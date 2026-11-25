import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { beforeAll, expect, test, vi } from "vitest";
import { i18n } from "../../../../i18n/index.ts";
import { GoalCard } from "./GoalCard.tsx";

beforeAll(async () => {
    await i18n.changeLanguage("zh");
});

function renderGoal(options: {
    running: boolean;
    disabled?: boolean;
    editDisabled?: boolean;
}): string {
    return renderToStaticMarkup(
        <I18nextProvider i18n={i18n}>
            <GoalCard
                goal={{
                    content: "Ship feature A",
                    createdAt: Date.now() - 60_000,
                    updatedAt: Date.now()
                }}
                running={options.running}
                disabled={options.disabled ?? false}
                editDisabled={options.editDisabled ?? false}
                onDelete={vi.fn()}
                onPause={vi.fn()}
                onResume={vi.fn()}
                onEdit={vi.fn()}
            />
        </I18nextProvider>
    );
}

function hasDisabledAttribute(button: string | undefined): boolean {
    return /\sdisabled(?:=""|(?=[\s>]))/.test(button ?? "");
}

test("renders paused goals with resume and edit controls", () => {
    const html = renderGoal({
        running: false,
        editDisabled: true
    });

    expect(html).toContain('data-running="false"');
    expect(html).toContain("目标已暂停");
    expect(html).toContain("Ship feature A");
    expect(html).toContain('aria-label="继续目标"');
    expect(html).not.toContain('aria-label="暂停目标"');
    expect(html).toContain('aria-label="删除目标"');
    expect(html).toContain('aria-label="编辑目标"');

    const editButton = html.match(
        /<button[^>]*aria-label="编辑目标"[^>]*>/
    )?.[0];
    expect(hasDisabledAttribute(editButton)).toBe(true);
});

test("keeps pause available while a running goal is globally disabled", () => {
    const html = renderGoal({
        running: true,
        disabled: true
    });

    expect(html).toContain('data-running="true"');
    expect(html).toContain("目标进行中");
    expect(html).toContain('aria-label="暂停目标"');
    expect(html).not.toContain('aria-label="继续目标"');

    const pauseButton = html.match(
        /<button[^>]*aria-label="暂停目标"[^>]*>/
    )?.[0];
    expect(hasDisabledAttribute(pauseButton)).toBe(false);
});
