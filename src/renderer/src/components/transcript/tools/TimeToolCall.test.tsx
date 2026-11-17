import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { afterEach, expect, test, vi } from "vitest";
import { i18n } from "../../../../../i18n/index.ts";
import { LocalTimeToolCall, SleepToolCall } from "./TimeToolCall.tsx";

afterEach(() => {
    vi.restoreAllMocks();
});

test("renders local time as a dedicated time card", () => {
    const html = renderToStaticMarkup(
        <I18nextProvider i18n={i18n}>
            <LocalTimeToolCall data={{
                kind: "time.local_time",
                localTime: "2026-11-16T13:30:05.000+08:00",
                timeZone: "Asia/Hong_Kong",
                utcOffset: "+08:00",
                epochMillis: 1_763_501_405_000,
                output: "",
                status: "completed"
            }} />
        </I18nextProvider>
    );

    expect(html).toContain('data-slot="local-time-tool"');
    expect(html).toContain("13:30:05");
    expect(html).toContain("2026-11-16");
    expect(html).toContain("Asia/Hong_Kong");
    expect(html).toContain("UTC+08:00");
});

test("renders sleep as a live countdown card", () => {
    const startedAt = 1_763_501_405_000;
    vi.spyOn(Date, "now").mockReturnValue(startedAt);

    const html = renderToStaticMarkup(
        <I18nextProvider i18n={i18n}>
            <SleepToolCall data={{
                kind: "time.sleep",
                durationMs: 65_000,
                startedAt,
                elapsedMs: 0,
                output: "",
                status: "running"
            }} />
        </I18nextProvider>
    );

    expect(html).toContain('data-slot="sleep-tool"');
    expect(html).toContain('data-status="running"');
    expect(html).toContain('role="timer"');
    expect(html).toContain("00:01:05");
    expect(html).not.toContain("conic-gradient");
});

test("shows elapsed sleep time after completion", () => {
    const startedAt = 1_763_501_405_000;

    const html = renderToStaticMarkup(
        <I18nextProvider i18n={i18n}>
            <SleepToolCall data={{
                kind: "time.sleep",
                durationMs: 3_725_000,
                startedAt,
                elapsedMs: 3_725_000,
                output: "Slept for 3725000 ms.",
                status: "completed"
            }} />
        </I18nextProvider>
    );

    expect(html).toContain('data-status="completed"');
    expect(html).toContain("01:02:05");
});
