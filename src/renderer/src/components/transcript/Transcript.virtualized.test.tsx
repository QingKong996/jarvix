// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { i18n } from "../../../../i18n/index.ts";

const { committed } = vi.hoisted(() => ({
    committed: [
        {
            id: "user-1",
            role: "user",
            text: "User prompt",
            blocks: [],
            error: null,
            reason: null
        }
    ]
}));

vi.mock("./state/transcript-hooks.ts", () => ({
    useCommitted: () => committed,
    useLive: () => null,
    useInjected: () => []
}));

const originalResizeObserver = globalThis.ResizeObserver;
const originalClientHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientHeight"
);
const originalClientWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientWidth"
);

let Transcript: typeof import("./Transcript.tsx").Transcript;

beforeAll(async () => {
    await i18n.changeLanguage("zh");
    Object.defineProperty(globalThis, "ResizeObserver", {
        configurable: true,
        value: class {
            observe(): void {}
            unobserve(): void {}
            disconnect(): void {}
        }
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
        configurable: true,
        get: () => 600
    });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
        configurable: true,
        get: () => 800
    });
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
        configurable: true,
        value: vi.fn()
    });
    ({ Transcript } = await import("./Transcript.tsx"));
});

afterAll(() => {
    Object.defineProperty(globalThis, "ResizeObserver", {
        configurable: true,
        value: originalResizeObserver
    });
    if (originalClientHeight) {
        Object.defineProperty(
            HTMLElement.prototype,
            "clientHeight",
            originalClientHeight
        );
    }
    if (originalClientWidth) {
        Object.defineProperty(
            HTMLElement.prototype,
            "clientWidth",
            originalClientWidth
        );
    }
});

test("renders items when the virtualized transcript first mounts", async () => {
    const { container } = render(
        <I18nextProvider i18n={i18n}>
            <Transcript sessionId="session-test" />
        </I18nextProvider>
    );

    expect(await screen.findByText("User prompt")).toBeTruthy();
    expect(container.querySelector("section > div > div.relative")).toBeTruthy();
});
